import sqlite3,tempfile,unittest,zipfile
from pathlib import Path
from unittest.mock import patch
import server

def row(cid,name,aliases,lat,lon,cc,pop):
    data=[str(cid),name,name,aliases,str(lat),str(lon),"P","PPL",cc,
          "","","","","",str(pop),"","","",""]
    return "\t".join(data)

class CityIndexTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.db=Path(self.temp.name)/"test.sqlite3"
        arc=Path(self.temp.name)/"test.zip"
        entries=[
          row(1,"Muscat","مسقط,Masqat",23.58,58.40,"OM",700000),
          row(2,"Damascus","د مشق,دمشق,Dimasq",33.5,36.3,"SY",1750000),
          row(3,"Dublin","دبلن,Baile Átha Cliath",53.3,-6.2,"IE",590000),
          row(4,"Moscow","Москва,موسكو",55.75,37.62,"RU",12000000),
          row(5,"Tokyo","東京,طوكيو",35.68,139.69,"JP",13000000),
        ]
        with zipfile.ZipFile(arc,"w") as z:z.writestr("cities1000.txt","\n".join(entries))
        self.stats=server.make_index(arc,self.db)
    def test_normalization(self):
        self.assertEqual(server.canonical("دَمَشْق"),"دمشق")
        self.assertEqual(server.canonical("آسِيَا"),"اسيا")
        self.assertEqual(server.canonical("إِصْفَهَان"),"اصفهان")
    def test_full_arabic_russian_japanese_english_queries(self):
        with patch.object(server,"DB",self.db):
            for typed,expected in [
              ("دمشق","Damascus"),("دبلن","Dublin"),("مسقط","Muscat"),
              ("Москва","Moscow"),("東京","Tokyo"),("Muscat","Muscat"),
            ]:
                result=server.search(typed)
                self.assertTrue(result,typed)
                self.assertEqual(result[0]["properties"]["name_en"],expected)
                self.assertIn("geonames_id",result[0]["properties"])
    def test_display_spelling_prefers_exact_alias_over_compact_variant(self):
        with patch.object(server,"DB",self.db):
            self.assertEqual(server.search("دمشق")[0]["properties"]["name"],"دمشق")
    def test_absent_and_two_letter_are_not_fabricated(self):
        with patch.object(server,"DB",self.db):
            self.assertEqual(server.search("zzunknown"),[])
            self.assertTrue(server.search("دم"))
    def test_schema_license_data(self):
        self.assertEqual(self.stats[0],6) # GeoNames fixture + curated mapped wilayat
        self.assertGreater(self.stats[1],10)
        with patch.object(server,"DB",self.db):
            sample=server.search("Dublin")[0]
            self.assertEqual(sample["properties"]["country"],"IE")
            self.assertAlmostEqual(sample["geometry"]["coordinates"][0],-6.2)

    def test_kamil_wal_wafi_full_and_short_names_across_arabic_spaces(self):
        with patch.object(server,"DB",self.db):
            for q in ("الكامل","الكامل والوافي","الكامل و الوافي",
                      "ولاية الكامل والوافي","Al Kamil","Al Kamil Wa Al Wafi",
                      "Al-Kamil Wal-Wafi"):
                got=server.search(q)
                self.assertTrue(got,q)
                self.assertEqual(got[0]["properties"]["geonames_id"],11054689,q)
                self.assertEqual(got[0]["properties"]["country"],"OM",q)
            self.assertEqual(server.search("zzyyunknowncity"),[])
    def test_offline_index_revision_requires_atomic_rebuild_after_upgrade(self):
        with sqlite3.connect(self.db) as con:
            value=con.execute("SELECT v FROM meta WHERE k='indexRevision'").fetchone()
        self.assertEqual(value[0],server.INDEX_REVISION)
