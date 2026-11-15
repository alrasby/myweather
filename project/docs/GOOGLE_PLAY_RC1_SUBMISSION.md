# طقسي — Google Play / Android اعتماد RC1 (Build 69)

**مرشح من `main` المستقر، وليس نشرًا عامًا.** بني من شيفرة Build 68 المعتمدة مع رفع versionCode فقط إلى **69** حتى نميز نسخة الاختبار ونحافظ على ترقية البيانات والهوية.

## الثوابت
| عنصر | قيمة |
|---|---|
| Play package / applicationId | `net.nabdhserv.myweather` — لا تغيّره |
| Version name | `1.0.0` |
| Version code | `69` (لا يمكن إعادة استخدامه لنفس تطبيق Play بعد رفعه) |
| minSdk / targetSdk | 24 / **36** (Android 16) |
| شهادات الرفع | شهادة APK الحالية من أسرار GitHub، SHA256 `3beb5ef19402c3411be1ad094a9f51fea80d3a35e5b92971b47f5f84169a0e91`؛ لا تخزّن المفتاح في المستودع |
| مخرجات `main` | Android APK للتجربة + Android App Bundle `.aab` موقّع لرفع Play، وSHA256SUMS.txt |
| PyFES/EOT20 | **غير مفعّل** (`VITE_EOT20_TIDE_ENABLED=0`)؛ التطوير مؤجل إلى GitHub #99 |

## إنشاء النسخة الموقعة
1. بعد نجاح PR ودمجه في `main`، يعمل GitHub Actions **MyWeather Play candidate — signed AAB and tester APK** عند تعديل ملف مسار الإصدار. ويمكن إعادة تشغيله يدويًا باستخدام `workflow_dispatch` من `main`.
2. الخيار `upload_internal_draft=false` يبني AAB+APK ويودعهما في GitHub Actions artifacts لمدة 30 يومًا. **هذا لا يرفع أي شيء إلى Google Play.**
3. يرفض المسار نسخة غير موقّعة، أو package مختلفًا، أو توقيعًا آخر، أو targetSdk بخلاف 36، أو تفعيل PyFES.
4. يُحمّل APK للتثبيت المباشر عبر Android على الأجهزة التجريبية. **لا يثبت AAB مباشرة**؛ يُرفع إلى Google Play أو يحوَّل باستخدام bundletool ضمن عملية معتمدة.

## الرفع إلى Play Console — المسودة الداخلية فقط
1. افتح https://play.google.com/console بحساب Google Play Developer المرخّص.
2. أنشئ أو اختر التطبيق بالمعرّف **`net.nabdhserv.myweather`**. اتبع متطلبات الدولة والتحقق من الهوية والتصنيفات. إذا كان هذا أول إصدار، ارفع ملف AAB يدويًا أول مرة إلى **Test and release → Testing → Internal testing** لتأسيس حزمة التطبيق وشهادة الرفع. راجع Play App Signing قبل التأكيد.
3. قارن بصمة شهادة رفع التطبيق في Play Console ببصمة AAB المرفقة. **Play App Signing** قد يوقّع تطبيق المستخدم بمفتاح آخر؛ إذا كان دعم الترقية فوق APK المثبت مباشرة مطلوبًا، فراجع اختيار مفتاح توقيع Play بعناية قبل أول نشر.
4. أضف مستخدمي اختبار داخليًا في Play Console. وثّق استلام الرابط وجرّب التثبيت والتحديث على جهاز فعلي.
5. بعد إنشاء التطبيق وتهيئة الصلاحية، يمكن تفعيل الأتمتة بإنشاء خدمة Google Cloud ذات صلاحية **ذلك التطبيق فقط** في Google Play Android Developer API، ثم حفظ بيانات اعتمادها في GitHub Actions Secret باسم `MYWEATHER_GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`. لا تلصق المفتاح في هذه المحادثة أو ملفات المشروع أو السجلات.
6. أعد تشغيل workflow من `main` بخيار `upload_internal_draft=true`. ستنشئ الأتمتة **مسودة على مسار internal فقط** (`status=draft` و`changesNotSentForReview=true`)، ولا تضغط على نشر Production. أكمل مراجعة المسودة في Play Console يدويًا.
7. لا تسلّم التطبيق للإنتاج/التوزيع العام قبل الموافقة على مصدر البيانات والعقد وأذونات بيانات المستخدم والخصوصية، ومراجعة الاختبارات على هواتف فعلية. راجع `project/docs/PROVIDER_RELEASE_SIGNOFF_2026-11.md`.

## البيانات والالتزام — لا تفترض الإجابات
- **الموقع:** AndroidManifest يطلب `ACCESS_FINE_LOCATION` و`ACCESS_COARSE_LOCATION`، ولا يطلب إذن الموقع بالخلفية. قبل إرسال نموذج **Data safety** تحقق من طلبات GPS الفعلية ومن البيانات المرسلة إلى Open-Meteo وMET Norway وخدمات البحث والخرائط، وحالات التخزين والمشاركة والاحتفاظ والأمان.
- **سياسة الخصوصية:** أضف رابط HTTPS عامًّا على نطاق مملوك ومضمون الوصول له. لا تخترع رابطًا ولا تنسخ نص سياسة عامة؛ يجب مطابقة التنفيذ الحقيقي والمزودين وSDKs وبيانات الوصول.
- **ترخيص البيانات:** النسخة الحالية تعتمد على API Open-Meteo ومجموعة خرائط Esri؛ احتفظ بالإسناد، وراجع حقوق الاستخدام التجاري/النشر والحدود. الترخيص غير معتمد بعد. MET Norway وGeoNames لهما نسب بيانات وإشعار حقوق. التفصيل في `project/docs/PROVIDER_RELEASE_SIGNOFF_2026-11.md`.
- **عرض التطبيق:** الوصف العربي والإنجليزي في `project/distribution/play-listing/`. الاستعراض العام يتطلب أيقونة 512×512 وfeature graphic 1024×500 ولقطات شاشة أصلية وموافقة سياسة محتوى (وجميع النماذج التي يطلبها Play Console). لا تعلن عن PyFES أو قياس مدّ وجزر ملاحي أو بيانات غير معتمدة.
- **السياسات:** استكمل Content rating وData safety وApp access وAds declaration وTarget audience وPermissions وإقرارات Android Auto/Wear إذا كانت مطلوبة. استخدام `androidx.car.app` وخدمة CarApp قد يخضع لفحص فئات تطبيقات السيارات.
- **الحساب الشخصي الجديد:** بعض حسابات المطورين الشخصية الحديثة تتطلب اختبارًا مغلقًا باثني عشر مشاركًا لمدة 14 يومًا قبل طلب Production. لا تفترض أن هذا الشرط ينطبق على حساب المالك دون التحقق.

## مسار التسليم المعتمد
- SDK واسم الحزمة والتوقيع وفحوص Android من `main`: آلي وقابل للتكرار.
- اختبار Play الداخلي: **مسودة/تجربة فقط إلى حين مراجعة الحساب والمصادر**.
- النشر العام: **ليس مفعّلًا آليًا** ولا يساوي اعتماد مصدر/ترخيص أو اجتياز مراجعة Play.

### مصادر رسمية
- https://developer.android.com/google/play/requirements/target-sdk
- https://developer.android.com/studio/publish/app-signing
- https://support.google.com/googleplay/android-developer/answer/14151465
- https://support.google.com/googleplay/android-developer/answer/10144311
- https://support.google.com/googleplay/android-developer/answer/9845334
