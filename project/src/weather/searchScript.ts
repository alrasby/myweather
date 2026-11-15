/** Choose lookup language from typed script, not solely from UI locale. */
export function queryLanguage(query:string,preferred:string):string {
 const base=(preferred||"en").toLowerCase().split(/[-_]/,1)[0]||"en";
 if(/\p{Script=Arabic}/u.test(query))return ["ar","fa","ur","ps"].includes(base)?base:"ar";
 if(/\p{Script=Hangul}/u.test(query))return "ko";
 if(/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query))return "ja";
 // Han characters alone are shared by Chinese and Japanese; UI language is
 // the only reliable preference, and the geocoder tries the other as fallback.
 if(/\p{Script=Han}/u.test(query))return base==="ja"?"ja":"zh";
 if(/\p{Script=Cyrillic}/u.test(query))
   return /[іїєґ]/iu.test(query)||base==="uk"?"uk":base==="bg"?"bg":"ru";
 if(/\p{Script=Greek}/u.test(query))return "el";
 if(/\p{Script=Hebrew}/u.test(query))return "he";
 if(/\p{Script=Thai}/u.test(query))return "th";
 if(/\p{Script=Devanagari}/u.test(query))return "hi";
 if(/\p{Script=Bengali}/u.test(query))return "bn";
 if(/\p{Script=Georgian}/u.test(query))return "ka";
 if(/\p{Script=Armenian}/u.test(query))return "hy";
 if(/\p{Script=Tamil}/u.test(query))return "ta";
 if(/\p{Script=Telugu}/u.test(query))return "te";
 return /^[a-z]{2,3}$/.test(base)?base:"en";
}
export const nonLatinCityQuery=(value:string):boolean=>
 /[\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Greek}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Georgian}\p{Script=Armenian}]/u.test(value);
