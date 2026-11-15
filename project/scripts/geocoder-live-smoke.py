#!/usr/bin/env python3
"""Real production-endpoint smoke + bounded latency samples; no credentials."""
import json,os,time,urllib.error,urllib.parse,urllib.request,statistics
BASE=os.environ.get("CITY_API","https://myweather-city-search-production.up.railway.app")
def request(path,query=None):
    url=BASE+path
    if query:url+="?"+urllib.parse.urlencode(query)
    req=urllib.request.Request(url,headers={"User-Agent":"MyWeather-GHA-LiveQA/1.0"})
    start=time.perf_counter()
    with urllib.request.urlopen(req,timeout=12) as res:
        assert res.status==200,(url,res.status)
        assert "geonames" in res.headers.get("X-Data-License","").lower()
        raw=res.read(150_000)
        obj=json.loads(raw.decode("utf8"))
    return obj,round((time.perf_counter()-start)*1000,1)
def main():
    health,ms=request("/health")
    assert health.get("ready") and health.get("cities",0)>100_000,health
    print("health",{"ready":health["ready"],"cities":health["cities"],
       "aliases":health["aliases"],"ms":ms})
    queries=[("الكامل","ar"),("الكامل والوافي","ar"),
      ("الكامل و الوافي","ar"),("Al Kamil Wal Wafi","en"),
      ("دمشق","ar"),("دبلن","ar"),("مسقط","ar"),
      ("Москва","ru"),("東京","ja"),("Prague","en"),
      ("Muscat","en"),("Dubai","en")]
    ok=0;durations=[]
    for q,lang in queries:
        reply,t=request("/api",{"q":q,"lang":lang,"limit":6,"layer":"city"})
        items=reply.get("features",[])
        assert items,(q,reply)
        if q=="دمشق":
            assert items[0]["properties"]["name"]=="دمشق",items[0]["properties"]
        if q in ("الكامل","الكامل والوافي","الكامل و الوافي","Al Kamil Wal Wafi"):
            assert items[0]["properties"]["geonames_id"]==11054689,(q,items[:2])
        assert all(item["properties"].get("geonames_id") and
          item["properties"].get("source")=="geonames" for item in items),q
        lat=items[0]["geometry"]["coordinates"][1];lon=items[0]["geometry"]["coordinates"][0]
        assert -90<=lat<=90 and -180<=lon<=180
        durations.append(t);ok+=1
        print(json.dumps({"query":q,"lang":lang,"top":items[0]["properties"]["name"],
          "city_id":items[0]["properties"]["geonames_id"],"ms":t},ensure_ascii=False))
    for _ in range(8):
        _,t=request("/api",{"q":"Mus","lang":"en","limit":6})
        durations.append(t)
    s=sorted(durations);p95=s[min(len(s)-1,int(len(s)*0.95))]
    print(json.dumps({"status":"PASS","cases":ok,"samples":len(s),
       "p50_ms":statistics.median(s),"p95_ms":p95,"max_ms":max(s)}))
if __name__=="__main__":main()
