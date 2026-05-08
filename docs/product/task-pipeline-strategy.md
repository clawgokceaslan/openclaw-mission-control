# Task Pipeline MVP Strateji Notu

## Karar Özeti

İlk sürüm, tek bir geliştirme taskının fikirden doğrulanmış çıktıya taşınmasını yöneten **Task Pipeline** deneyimine odaklanır. Amaç, kullanıcının ayrı ayrı "Auto Plan" ve "Auto Run" komutları seçmesi yerine taskı tek merkezden ilerletmesi, durumunu anlaması, gerektiğinde müdahale etmesi ve sonucu doğrulamasıdır.

Bu strateji, mevcut task modeli ve `TaskPlannerChatPopup` sınırları içinde uygulanabilir bir MVP tanımlar. Çoklu task orkestrasyonu, dış CI/CD entegrasyonları, takım bazlı izinler, kurumsal audit yapısı ve gelişmiş otomasyon şablonları sonraki katmanlara bırakılır.

## Mevcut Akış Envanteri

Bugünkü ürün yüzeyi planlama ve çalıştırmayı ayrı temas noktalarında gösterir. Bu envanter, MVP kararlarının mevcut modele bağlı kalmasını sağlar.

| Yüzey | Bugünkü rol | MVP'de korunacak varsayım |
| --- | --- | --- |
| `TaskPlannerChatPopup` | Geniş kapsamı bağımsız task taslaklarına bölen PM chat ve önizleme akışı. | İlk MVP uzun form eklemeden bu popup sınırında tek task pipeline kontrol merkezine genişletilebilir. |
| `PlanChoiceModal` | Kullanıcı planlama başlamadan önce "onay sorularıyla planla" veya "doğrudan planla" kararını verir. | Planlama kontrol noktası korunur; serbest prompt yerine kısa karar/onay akışı olarak yeniden adlandırılır. |
| `AutoPlansPage` | Planlanmamış taskları plan kuyruğuna alır, ask-first/direct moduyla seri planlatır ve çalışan/planlanan kayıtları gösterir. | Çoklu plan kuyruğu ikinci katmandır; MVP tek task görünümündeki "Planla" aşamasını netleştirir. |
| `AutoRunPage` | Planlanmış ve çalıştırılabilir taskları çalıştırma kuyruğuna alır, sırayı düzenletir ve çalışan aktiviteyi gösterir. | Çoklu çalıştırma kuyruğu ikinci katmandır; MVP tek task görünümündeki "Çalıştır" aşamasını netleştirir. |
| `RunningGatewayMenu` | Aktif Codex konuşmalarını Planla, Çalıştır ve Doğrula gruplarında gösterir. | Aşama isimleri mevcut teknik conversation tiplerine bağlı kalabilir; kullanıcı metni task yaşam döngüsü diliyle sadeleşir. |
| `PlannedTasksMenu` | Planı hazır olan taskları üst menüden çalıştırılabilir liste olarak gösterir. | "Plan hazır" durumundan "Çalıştır" aksiyonuna geçiş korunur; ayrı bir komut gibi değil pipeline sonraki adımı gibi sunulur. |
| Task aktivite geçmişi | `gateway-plan`, `gateway-run`, `gateway-chat` kaynaklı mesajlar, çalışan/duran durumlar ve run-complete kayıtları taşır. | İlk sürüm yeni task modeli gerektirmeden bu kaynakları zaman çizgisi/aktivite geçmişi olarak gruplayabilir. |
| Task durum türetimi | `PLAN:not-planned`, `PLAN:planned`, çalışan run kayıtları, `post-run` doğrulama ve başarısız/terminal mesajlardan yüzey statüsü çıkarılır. | Belirsiz `running`/`pending` dili kullanıcıya gösterilmez; aynı veri kullanıcı dostu aşama ve sonraki aksiyona çevrilir. |

Korunması gereken masaüstü deneyimi: hızlı açılan popup, üst menüden aktif iş takibi, sürükle-bıraklı kuyrukların ayrı sayfalarda kalması ve task detayına geri dönüş. MVP bu yüzeyleri tek ekranda birleştirmeye çalışmaz; tek task bağlamında planlama, çalıştırma, doğrulama ve tamamlama bilgisini aynı kontrol merkezinde okunur hale getirir.

## MVP Kapsamı

### Must

- Tek task için birleşik pipeline görünümü: planlama, çalışma, doğrulama ve tamamlama aynı merkezde görünür.
- Planlama ve çalıştırma ayrı teknik komutlar gibi değil, task yaşam döngüsünün ardışık adımları gibi sunulur.
- Kullanıcı taskı başlatabilir, duraklatabilir, devam ettirebilir, yeniden deneyebilir ve manuel müdahale gerektiren noktaları görebilir.
- Ajan aktivite geçmişi; ne yapıldı, hangi dosyalar veya kararlar etkilendi, neden duruldu ve sıradaki adım ne sorularına cevap verir.
- Belirsiz ara durumlar kaldırılır; her task açık bir pipeline aşaması ve kullanıcı dostu durum etiketi taşır.

### Should

- Bloke durumları, kullanıcı onayı gerektiren noktalar, hata ve geri kazanım mesajları açık görünür.
- Son çalıştırma özeti; tamamlanan adımları, kalan riski, doğrulama sonucunu ve önerilen sonraki aksiyonu gösterir.
- Kullanıcı uzun form doldurmadan hızlıca task metnini, planı ve çalıştırma tercihlerini düzenleyebilir.

### Could

- Task tipine göre pipeline şablonları.
- Otomasyon seviyesi seçimi.
- Toplu çalıştırma ve çoklu task görünümü.
- Görsel timeline ve detaylı aşama geçmişi.

### Won't

- İlk sürümde dış CI/CD veya deploy pipeline yönetimi yoktur.
- İlk sürümde takım bazlı gelişmiş yetki modeli ve kurumsal audit sistemi yoktur.
- İlk sürümde tüm task tipleri için gelişmiş otomasyon şablonları yoktur.
- İlk sürüm çoklu task orkestrasyon merkezi değildir; tek task deneyimi tamamlanmadan genişletilmez.

## Kullanıcı Odaklı İsimlendirme

Ana çerçeve: **Task Pipeline**. Bu ifade sadece ürün içi agentic task yaşam döngüsünü anlatır; CI/CD, deploy veya altyapı pipeline'ı anlamında kullanılmaz.

Birincil eylem etiketi: **Taskı İlerlet**.

Bu etiket, "ajanı çalıştır" hissi yerine "taskı sonuç odaklı ilerlet" hissi verir. Taskı İlerlet eylemi içeride planlama, çalıştırma, doğrulama ve tamamlamayı kapsayan orkestrasyon başlatır.

Adım etiketleri:

| Eski teknik dil | Yeni kullanıcı dili | Kullanıcıya verdiği anlam |
| --- | --- | --- |
| Auto Plan | Planla | Task için uygulanabilir yolu çıkar |
| Auto Run | Çalıştır | Onaylanan planı yürüt |
| Manual prompt | Müdahale et | Gereken yerde kısa karar veya bilgi ver |
| Retry run | Yeniden dene | Hata veren adımı aynı bağlamla tekrar çalıştır |
| Validate | Doğrula | Çıktının kabul sinyaline uyduğunu kontrol et |
| Complete | Tamamla | Sonucu ve kalan riski kayda geçir |

Yardımcı metin örnekleri:

- Taskı İlerlet: "Planı çıkarır, çalıştırır ve sonucu doğrulama için hazırlar."
- Planla: "Ajan, taskı uygulanabilir adımlara böler."
- Çalıştır: "Ajan, onaylanan plan üzerinden değişiklikleri uygular."
- Doğrula: "Kontroller ve kabul sinyalleri sonuçla eşleştirilir."
- Tamamla: "Özet, değişiklikler ve kalan risk kayda geçirilir."

Ekranda görünmemesi gereken teknik terimler:

- Auto Plan
- Auto Run
- batch
- queue worker
- pipeline job
- CI/CD
- deploy pipeline
- runner internals

Teknik terimler yalnızca geliştirici logları veya hata ayıklama detaylarında kullanılabilir; ana kullanıcı deneyiminde sonuç odaklı dil korunur.

## Tek Merkezli Pipeline Davranışı

Pipeline, `TaskPlannerChatPopup` içinde tek taska bağlı bir kontrol merkezi gibi davranır. Kullanıcı bir taskı açtığında mevcut aşama, önerilen sonraki aksiyon, ajan çıktısı ve müdahale noktaları aynı yüzeyde görünür.

### 1. Hazırla

- Kullanıcı tetikleyicisi: Kullanıcı task açıklamasını girer veya mevcut tasktan "Taskı İlerlet" aksiyonunu seçer.
- Sistem durumu: `Hazırlanıyor`.
- Ajan çıktısı: Eksik bağlam, önerilen kapsam ve hızlı düzenlenebilir başlangıç özeti görünür.
- Kullanıcı kontrolü: Kullanıcı task metnini, kabul sinyalini ve kapsam dışı maddeleri kısa alanlarda düzenleyebilir.

### 2. Planla

- Kullanıcı tetikleyicisi: Kullanıcı "Planla" veya birleşik akışta "Taskı İlerlet" der.
- Sistem durumu: `Planlanıyor`.
- Ajan çıktısı: Alt görevler, bağımlılıklar, riskler ve gerekli kullanıcı kararları görünür.
- Kullanıcı kontrolü: Planı onayla, düzenle veya yeniden oluştur seçenekleri sunulur.

### 3. Çalıştır

- Kullanıcı tetikleyicisi: Kullanıcı onaylanan plandan "Çalıştır" der veya otomatik akış onaylı planla devam eder.
- Sistem durumu: `Çalışıyor`.
- Ajan çıktısı: İşlenen adım, yapılan değişiklikler, aktif komutlar ve beklenen çıktı akışı görünür.
- Kullanıcı kontrolü: Duraklat, manuel müdahale ekle veya iptal et seçenekleri bulunur.

### 4. Müdahale Et

- Kullanıcı tetikleyicisi: Ajan karar, kimlik bilgisi, kapsam onayı veya çakışma çözümü gerektiğinde durur.
- Sistem durumu: `Onay Bekliyor` veya `Bloke`.
- Ajan çıktısı: Neden durulduğu, hangi kararın gerektiği ve önerilen güvenli seçenekler açıkça yazılır.
- Kullanıcı kontrolü: Onayla, düzenle, reddet, manuel talimat ver veya kapsamı küçült seçenekleri sunulur.

### 5. Doğrula

- Kullanıcı tetikleyicisi: Çalıştırma tamamlandığında sistem otomatik doğrulamaya geçer veya kullanıcı "Doğrula" der.
- Sistem durumu: `Doğrulanıyor`.
- Ajan çıktısı: Çalıştırılan kontroller, geçemeyen kontroller, manuel kontrol gerektiren alanlar ve kabul sinyali eşleşmesi görünür.
- Kullanıcı kontrolü: Yeniden dene, manuel doğrulandı olarak işaretle veya eksik adım aç seçenekleri sunulur.

### 6. Tamamla

- Kullanıcı tetikleyicisi: Doğrulama başarılı olduğunda veya kullanıcı kabul edilen riskle tamamlamayı seçtiğinde çalışır.
- Sistem durumu: `Tamamlandı` veya `Riskle Tamamlandı`.
- Ajan çıktısı: Değişen dosyalar, özet, doğrulama notu, kalan risk ve önerilen sonraki task görünür.
- Kullanıcı kontrolü: Sonucu kabul et, yeniden aç veya yeni takip taskı oluştur.

## Durum ve Aktivite Sözlüğü

### Pipeline Aşamaları

| Aşama | Kullanıcı metni | Sistem anlamı |
| --- | --- | --- |
| Hazırla | Task hazırlanıyor | Girdi, kapsam ve kabul sinyalleri toparlanıyor |
| Planla | Plan çıkarılıyor | Ajan uygulanabilir alt görev ve riskleri üretiyor |
| Çalıştır | Plan uygulanıyor | Ajan onaylı planı yürütüyor |
| Müdahale Et | Kullanıcı kararı gerekiyor | Ajan ilerlemek için karar veya bilgi bekliyor |
| Doğrula | Sonuç kontrol ediliyor | Kontroller ve kabul sinyalleri değerlendiriliyor |
| Tamamla | Çıktı kayda alındı | Sonuç, özet ve kalan risk kapatıldı |

### Task Statüleri

| Statü | Kullanıcı metni | Kabul edilen aksiyon |
| --- | --- | --- |
| Hazır | Başlatmaya hazır | Taskı İlerlet |
| Planlanıyor | Plan çıkarılıyor | Duraklat |
| Plan Onayı Bekliyor | Planı gözden geçir | Onayla veya düzenle |
| Çalışıyor | Plan uygulanıyor | Duraklat veya müdahale et |
| Onay Bekliyor | Kararın gerekiyor | Onayla, reddet veya bilgi ver |
| Bloke | İlerlemek için engel var | Engeli çöz veya kapsamı değiştir |
| Yeniden Denenebilir | Aynı adım tekrar denenebilir | Yeniden dene |
| Doğrulanıyor | Sonuç kontrol ediliyor | Bekle veya manuel kontrol ekle |
| Tamamlandı | Task tamamlandı | Sonucu kabul et |
| Riskle Tamamlandı | Task kabul edilen riskle kapandı | Takip taskı aç |
| Başarısız | Akış tamamlanamadı | Yeniden dene veya manuel devral |

Belirsiz veya kabul edilmeyen durumlar:

- "Running" yazıp hangi aşamada olduğunu göstermemek.
- "Pending" yazıp kullanıcının mı sistemin mi beklediğini açıklamamak.
- Hata sonrası yalnızca teknik log göstermek.
- Tamamlanmış görünen ama doğrulama veya kalan risk bilgisi olmayan task.
- Ajanın sessizce durduğu, sıradaki aksiyonun görünmediği task.

### Aktivite Geçmişi Olayları

Ajan aktivite geçmişi şu olayları göstermelidir:

- Plan oluşturuldu veya güncellendi.
- Kullanıcı planı onayladı, düzenledi veya reddetti.
- Ajan bir alt göreve başladı.
- Dosya, ayar veya task alanı değişti.
- Komut veya kontrol çalıştırıldı.
- Hata oluştu ve geri kazanım önerildi.
- Kullanıcı onayı istendi.
- Akış duraklatıldı veya devam ettirildi.
- Adım yeniden denendi.
- Doğrulama tamamlandı.
- Task tamamlandı veya riskle tamamlandı.

Her aktivite satırı kısa, zaman damgalı ve sonraki aksiyonu belli edecek şekilde yazılmalıdır. Gerekirse teknik detay genişletilebilir alanda tutulur.

### Hata ve Geri Kazanım Dili

- Bloke: "Bu adım ilerleyemiyor. Gerekli karar: [karar]. Önerilen seçenek: [seçenek]."
- Onay bekliyor: "Devam etmeden önce bu planı onayla veya düzenle."
- Yeniden denenebilir: "Bu adım tamamlanmadı, aynı bağlamla yeniden denenebilir."
- Manuel müdahale: "Ajanın ilerlemesi için kısa bir bilgi gerekiyor."
- Riskle tamamlandı: "Task kapandı, ancak şu risk takip edilmeli: [risk]."

## Başarı Ölçümü

North Star ile bağlantı: Bu MVP, kullanıcının bir taskı manuel koordinasyon yapmadan fikirden doğrulanmış çıktıya taşıyabildiği başarılı otomatik akış sayısını artırmaya odaklanır.

HEART eşleşmesi:

| HEART alanı | MVP ölçümü |
| --- | --- |
| Happiness | Kullanıcının akış netliği ve güven skoru |
| Engagement | Otomatik başlatılan task sayısı, kullanıcı başına aktif tek task pipeline sayısı |
| Adoption | "Taskı İlerlet" ile ilk task başlatma oranı |
| Retention | Tekrar otomatik task ilerleten kullanıcı oranı |
| Task Success | Tamamlanan pipeline oranı, müdahalesiz tamamlanan task oranı, bloke kalan task oranı, ortalama task tamamlama süresi |

Kabul sinyali eşleşmesi:

- Kullanıcı bir taskı tek merkezden planlayıp çalıştırabiliyor: Hazırla, Planla ve Çalıştır aşamaları aynı yüzeyde birleşir.
- Pipeline aşamalarında task durumu anlaşılır: Her task tek aşama, tek statü ve açık sonraki aksiyon taşır.
- Auto Plan/Auto Run yerine kullanılan isimler daha nettir: Birincil eylem "Taskı İlerlet", adımlar "Planla", "Çalıştır", "Doğrula", "Tamamla" olarak görünür.
- Belirsiz statü oranı düşer: Pending/running gibi açıklamasız durumlar yerine kullanıcı metni ve aksiyon gösterilir.
- Otomatik ilerletilen task sayısı artar: Birleşik eylem, plan ve çalıştırma arasındaki seçim yükünü azaltır.
- Kullanıcı manuel prompt yazmadan ilerleme sağlayabilir: Müdahale noktaları serbest prompt yerine karar, onay ve kısa bilgi akışına dönüştürülür.

## Risk Kararı

Risk: CodePipeline benzetmesi ürünü gereğinden fazla CI/CD veya deploy yönetimi gibi gösterebilir.

Karar: Risk kabul edilmez; ürün dili bu çağrışımı sınırlayacak şekilde daraltılır. "Task Pipeline" ifadesi yalnızca task yaşam döngüsü ve ajan orkestrasyonu anlamında kullanılır. Arayüzde CI/CD, deploy pipeline, build pipeline, job veya runner gibi terimler görünmez. İlk MVP dış servis deploy akışı değil, Open Mission Control içinde tek taskın planlanması, çalıştırılması, doğrulanması ve tamamlanmasıdır.

## Sonraki Uygulama Taskı İçin Net Girdi

Sonraki tasarım veya geliştirme taskı şu kararı baz almalıdır:

- `TaskPlannerChatPopup`, tek task pipeline kontrol merkezi olarak genişletilir.
- Ana CTA "Taskı İlerlet" olur.
- Aşama adları "Hazırla", "Planla", "Çalıştır", "Müdahale Et", "Doğrula", "Tamamla" olur.
- Auto Plan ve Auto Run kullanıcı arayüzünde birincil ürün dili olmaktan çıkar.
- Her aşama için kullanıcı tetikleyicisi, sistem durumu, ajan çıktısı ve kullanılabilir kontrol aksiyonları görünür.
- İlk uygulama kapsamı tek task ile sınırlıdır; çoklu task orkestrasyonu sonraki taska bırakılır.

## Kabul ve Devir Sözleşmesi

Sonraki uygulama taskı bu dokümanı tasarım sözleşmesi olarak kullanabilir. Teslim edilecek ilk ürün davranışı aşağıdaki maddelerle sınırlıdır:

1. Kullanıcı bir task detayından veya planlama popup akışından tek birincil aksiyonla `Taskı İlerlet` akışını başlatır.
2. Sistem aynı yüzeyde en az şu aşamaları gösterir: `Hazırla`, `Planla`, `Çalıştır`, `Müdahale Et`, `Doğrula`, `Tamamla`.
3. Her aşamada kullanıcıya üç bilgi verilir: mevcut durum, ajan çıktısı veya son aktivite, sıradaki güvenli aksiyon.
4. Planlama tamamlandığında task `Plan hazır` durumuna gelir ve sıradaki aksiyon `Çalıştır` olarak görünür.
5. Çalıştırma tamamlandığında task doğrudan belirsiz tamamlandı durumuna düşmez; `Doğrula` veya `Özet hazır` bilgisi görünür.
6. Ajan karar bekliyorsa serbest prompt zorunlu değildir; kullanıcı onay, düzenleme, reddetme, kısa bilgi verme veya kapsam küçültme seçeneklerinden biriyle ilerler.
7. Hata durumunda en az bir geri kazanım yolu görünür: `Yeniden dene`, `Müdahale et`, `Kapsamı değiştir` veya `Manuel devral`.
8. Tamamlama anında özet, değişen dosyalar veya etkilenen alanlar, doğrulama sonucu ve kalan risk kayda geçirilir.

Kapsam içi bağımlılıklar:

- Mevcut task modeli, task activity mesajları ve gateway conversation kaynakları kullanılmalıdır.
- `TaskPlannerChatPopup` ilk tek task pipeline kontrol merkezi olarak ele alınmalıdır.
- Üst menüdeki aktif/planlı task yüzeyleri yardımcı görünürlük olarak kalabilir; MVP'nin ana kabulü tek task deneyimidir.
- Stil veya UI uygulaması yapılacaksa her parça kendi `index.tsx` ve `index.module.scss` dosyasında, mevcut parent-child hiyerarşisini nested SCSS ile koruyarak ilerlemelidir.

Kapsam dışı notları:

- Çoklu task orkestrasyon merkezi, toplu çalıştırma şablonları ve otomasyon seviyesi seçimi bu MVP'nin kabul koşulu değildir.
- Dış CI/CD, deploy pipeline, build job, runner yönetimi veya takım yetki modeli bu kararın parçası değildir.
- Kullanıcıya "Auto Plan" ve "Auto Run" ana ürün dili olarak gösterilmemelidir; teknik kaynak adları yalnızca log, telemetry veya geliştirici detayında kalabilir.

Risk kapanışı: CodePipeline benzetmesi kullanıcı dili olarak kullanılmaz. "Task Pipeline" ifadesi kalacaksa arayüzde her zaman task yaşam döngüsü, ajan orkestrasyonu ve doğrulanmış çıktı bağlamıyla birlikte kullanılmalıdır.
