"""Independent MyWeather city-only GeoNames geocoder; data CC BY 4.0."""
import io,json,os,re,sqlite3,threading,time,unicodedata,urllib.request,zipfile
from collections import defaultdict,deque
from datetime import datetime,timezone
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs,urlsplit

ROOT=Path(os.environ.get("GEOCODER_DATA_DIR","/data"))
DB=ROOT/"cities.sqlite3"
URL="https://download.geonames.org/export/dump/cities1000.zip"
STATE={"ready":False,"cities":0,"aliases":0,"version":None,"error":None}
LOCK=threading.Lock()
CALLS=defaultdict(deque)
TOTAL=deque()
SLOTS=threading.BoundedSemaphore(12)
INDEX_REVISION="global-city-aliases-v2"
# GeoNames ID for this mapped populated place; official Arabic wilayat name
# and romanizations are curated, not guessed from another town.
KAMIL_ID=11054689
KAMIL_ALIASES=("الكامل والوافي","الكامل و الوافي","الكامل","الوافي",
  "ولاية الكامل والوافي","Al Kamil Wal Wafi","Al Kamil Wa Al Wafi",
  "Al Kamil","Al Wafi","Al-Kamil Wal-Wafi")

def canonical(s):
    s=unicodedata.normalize("NFKC",s).casefold()
    s="".join(c for c in unicodedata.normalize("NFKD",s)
              if unicodedata.category(c) not in ("Mn","Me","Cf"))
    s=s.translate(str.maketrans({
      "أ":"ا","إ":"ا","آ":"ا","ٱ":"ا","ى":"ي","ی":"ي","ک":"ك",
      "ة":"ه","ؤ":"و","ئ":"ي","ـ":""}))
    return " ".join(re.sub(r"[-_.,'’/]+"," ",s).split())

def make_index(archive,path):
    path=Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    path.unlink(missing_ok=True)
    con=sqlite3.connect(path)
    try:
        con.executescript("""
        PRAGMA journal_mode=DELETE;
        PRAGMA synchronous=OFF;
        CREATE TABLE cities(id INTEGER PRIMARY KEY,name TEXT,lat REAL,lon REAL,country TEXT,pop INTEGER);
        CREATE TABLE aliases(k TEXT,n TEXT,city_id INTEGER);
        CREATE TABLE meta(k TEXT PRIMARY KEY,v TEXT);
        """)
        count=alias_count=0
        found_kamil=False
        def index_aliases(city_id,names):
            nonlocal alias_count
            seen=set()
            for name in names:
                label=name.strip()[:120]
                key=canonical(label)
                # Index compact Unicode variants in addition to human-spaced
                # aliases: 'الكامل و الوافي' == 'الكامل والوافي'.
                for candidate in (key,key.replace(" ","")):
                    if not 2<=len(candidate)<=100 or candidate in seen or "http" in candidate:
                        continue
                    seen.add(candidate)
                    con.execute("INSERT INTO aliases VALUES(?,?,?)",(candidate,label,city_id))
                    alias_count+=1
        with zipfile.ZipFile(archive) as z:
            member=next((n for n in z.namelist() if n.endswith("cities1000.txt")),None)
            if not member: raise ValueError("invalid geonames archive")
            with z.open(member) as f:
                for line in io.TextIOWrapper(f,encoding="utf8",errors="replace"):
                    v=line.rstrip("\n").split("\t")
                    if len(v)<15 or v[6]!="P": continue
                    try:
                        cid=int(v[0]);lat=float(v[4]);lon=float(v[5]);pop=max(0,int(v[14] or 0))
                        if not(-90<=lat<=90 and -180<=lon<=180):continue
                    except ValueError:continue
                    con.execute("INSERT INTO cities VALUES(?,?,?,?,?,?)",
                                (cid,v[1][:120],lat,lon,v[8][:2],pop))
                    names=(v[1],v[2],*v[3].split(",")[:160])
                    if cid==KAMIL_ID:
                        found_kamil=True
                        names=(*names,*KAMIL_ALIASES)
                    index_aliases(cid,names)
                    count+=1
                    if count>330_000:raise ValueError("unexpected city count")
        if not found_kamil:
            # Source dump can omit an administrative seat. Use its mapped
            # GeoNames populated-place ID/point, not an invented town.
            con.execute("INSERT INTO cities VALUES(?,?,?,?,?,?)",
                        (KAMIL_ID,"Al Kamil Wal Wafi",22.18068,59.22442,"OM",38543))
            index_aliases(KAMIL_ID,KAMIL_ALIASES)
            count+=1
        if count<5:raise ValueError("incomplete city archive")
        con.execute("CREATE INDEX alias_prefix ON aliases(k,city_id)")
        con.execute("INSERT INTO meta VALUES('builtUtc',?)",(datetime.now(timezone.utc).isoformat(),))
        con.execute("INSERT INTO meta VALUES('cities',?)",(str(count),))
        con.execute("INSERT INTO meta VALUES('aliases',?)",(str(alias_count),))
        con.execute("INSERT INTO meta VALUES('indexRevision',?)",(INDEX_REVISION,))
        con.commit()
        return count,alias_count
    finally:con.close()

def stats():
    with sqlite3.connect("file:"+str(DB)+"?mode=ro",uri=True) as con:
        values=dict(con.execute("SELECT k,v FROM meta"))
    return {"cities":int(values["cities"]),"aliases":int(values["aliases"]),
            "version":values["builtUtc"],"indexRevision":values.get("indexRevision")}

def rebuild():
    ROOT.mkdir(parents=True,exist_ok=True)
    temporary_zip=ROOT/"cities-download.tmp.zip"
    temporary_db=ROOT/"cities-next.tmp.sqlite3"
    try:
        req=urllib.request.Request(URL,headers={"User-Agent":"MyWeather/1.0 city index","Accept":"application/zip"})
        total=0
        with urllib.request.urlopen(req,timeout=70) as res,open(temporary_zip,"wb") as f:
            while block:=res.read(131072):
                total+=len(block)
                if total>65*1024*1024:raise ValueError("download too large")
                f.write(block)
        if not zipfile.is_zipfile(temporary_zip):raise ValueError("bad zip")
        make_index(temporary_zip,temporary_db)
        os.replace(temporary_db,DB)
    finally:
        temporary_zip.unlink(missing_ok=True)
        temporary_db.unlink(missing_ok=True)

def updater():
    while True:
        try:
            refresh=not DB.exists() or time.time()-DB.stat().st_mtime>30*86400
            if not refresh:
                try:refresh=stats().get("indexRevision")!=INDEX_REVISION
                except (sqlite3.Error,KeyError,ValueError):refresh=True
            if refresh:rebuild()
            STATE.update(ready=True,error=None,**stats())
        except Exception as e:
            STATE["error"]=type(e).__name__
            if not DB.exists():STATE["ready"]=False
        time.sleep(900 if not STATE["ready"] else 12*3600)

def search(q,limit=6):
    key=canonical(q)
    if not 2<=len(key)<=100:return []
    needles={key,key.replace(" ","")}
    rows=[]
    with sqlite3.connect("file:"+str(DB)+"?mode=ro",uri=True,timeout=3) as con:
        for needle in needles:
            rows.extend(con.execute("""
              SELECT a.n,a.k,c.id,c.name,c.lat,c.lon,c.country,c.pop
              FROM aliases a JOIN cities c ON c.id=a.city_id
              WHERE a.k>=? AND a.k<? LIMIT 2500
            """,(needle,needle+"\uffff")).fetchall())
    best={}
    for display,k,cid,name,lat,lon,country,pop in rows:
        score=(int(k in needles),int(k.startswith(key)),pop)
        if cid not in best or score>best[cid][0]:
            best[cid]=(score,{"type":"Feature",
              "geometry":{"type":"Point","coordinates":[lon,lat]},
              "properties":{"name":display,"name_en":name,
                "country":country,"osm_value":"city","geonames_id":cid,
                "source":"geonames","population":pop}})
    return [x[1] for x in sorted(best.values(),key=lambda x:x[0],reverse=True)[:max(1,min(limit,10))]]

def allow(ip):
    now=time.monotonic()
    with LOCK:
        while TOTAL and TOTAL[0]<now-60:TOTAL.popleft()
        items=CALLS[ip]
        while items and items[0]<now-60:items.popleft()
        if len(items)>=45 or len(TOTAL)>=480:return False
        items.append(now);TOTAL.append(now)
        if len(CALLS)>2048:
            for p in list(CALLS):
                if not CALLS[p] or CALLS[p][-1]<now-60:CALLS.pop(p,None)
        return True

class Handler(BaseHTTPRequestHandler):
    server_version="MyWeatherGeocoder/1.0"
    def log_message(self,*args):pass # Avoid storing city queries and IPs
    def respond(self,code,data,extra=None):
        b=json.dumps(data,ensure_ascii=False,separators=(",",":")).encode("utf8")
        self.send_response(code)
        for key,value in {"Content-Type":"application/json; charset=utf-8",
         "Content-Length":str(len(b)),"X-Data-License":"GeoNames CC BY 4.0",
         "Cache-Control":"public, max-age=600" if code==200 else "no-store",
         "Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, OPTIONS",
         "Access-Control-Allow-Headers":"Accept","X-Content-Type-Options":"nosniff",**(extra or {})}.items():
            self.send_header(key,value)
        self.end_headers();self.wfile.write(b)
    def do_OPTIONS(self):
        self.send_response(204);self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Methods","GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers","Accept");self.end_headers()
    def do_GET(self):
        url=urlsplit(self.path)
        if url.path=="/health":
            self.respond(200 if STATE["ready"] else 503,dict(STATE,source="GeoNames"));return
        if url.path!="/api":self.respond(404,{"error":"not-found"});return
        if not STATE["ready"]:self.respond(503,{"error":"index-initializing"});return
        if not allow(self.client_address[0]):self.respond(429,{"error":"rate-limited"},{"Retry-After":"15"});return
        if not SLOTS.acquire(blocking=False):
            self.respond(503,{"error":"busy"},{"Retry-After":"2"});return
        try:
            args=parse_qs(url.query)
            q=args.get("q",[""])[0].strip();lang=args.get("lang",["en"])[0]
            try:limit=min(10,max(1,int(args.get("limit",["6"])[0])))
            except ValueError:self.respond(400,{"error":"bad-limit"});return
            if not 2<=len(q)<=100 or not re.fullmatch(r"[a-z]{2,3}",lang):
                self.respond(400,{"error":"bad-query"});return
            try:items=search(q,limit)
            except sqlite3.Error:self.respond(503,{"error":"index-unavailable"});return
            self.respond(200,{"type":"FeatureCollection","features":items})
        finally:SLOTS.release()

if __name__=="__main__":
    port = int(os.environ.get("PORT","8000"))
    server = ThreadingHTTPServer(("0.0.0.0",port),Handler)
    print(f"MyWeatherGeoNames listening on 0.0.0.0:{port}",flush=True)
    threading.Thread(target=updater,daemon=True,name="geonames-updater").start()
    server.serve_forever()
