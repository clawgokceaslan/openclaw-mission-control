# Plan Pipeline ve Grup Yapısı Analizi

Bu not, repo içindeki Plan Pipeline, görev planlama yaşam döngüsü, proje grupları ve task export/import akışını kaynak kod üzerinden inceler. Ayrı ve kapsamlı bir Plan Pipeline dokümanı bulunmuyor; mevcut planning dokümanı `src/renderer/src/constants/codex-docs.ts` içinde Plan Pipeline alanını açıkça kapsam dışı bırakıyor. Bu eksiklik, aşağıdaki önerilerde ilk dokümantasyon boşluğu olarak ele alınmalıdır.

## Kaynak Haritası

| Kaynak | Kapsadığı alan |
| --- | --- |
| `src/renderer/src/screens/plan-pipeline/index.tsx` | Pipeline taslak sihirbazı, proje/task seçimi, grup oluşturma, localStorage taslak durumu, kaydetme, simüle edilmiş yerel run ve kayıtlı pipeline aksiyonları. |
| `src/renderer/src/screens/plan-pipeline-runs/index.tsx` | Kayıtlı pipeline kayıtlarının listelenmesi, progress özeti, seçili grup detayı, manuel başlatma ve retry aksiyonları. |
| `src/main/services/plan-pipeline.service.ts` | Pipeline kayıt oluşturma ve durum güncelleme için ana validasyon katmanı. |
| `src/db/repositories/plan-pipeline-repo.ts` | `plan_pipeline_records` kalıcı kayıt modeli, listeleme, çoklu kayıt oluşturma ve durum patch işlemleri. |
| `src/db/migrations/021_plan_pipeline_records.sql` | Pipeline kayıt şeması: grup adı, sıra, proje/task id listeleri, status, progress, retry, run mode, özet ve hata alanları. |
| `src/shared/types/entities.ts` | `PlanPipelineRecord`, `PlanPipelineStatus` ve `PlanPipelineRunMode` paylaşılan tipleri. |
| `src/shared/contracts/ipc.ts` | `plan-pipelines:list`, `create-from-groups`, `update-state` IPC yüzeyi. |
| `src/main/services/task.service.ts` | Asıl görev planlama/run yaşam döngüsü, OMC CLI helper, clarification, ready-for-review ve finish köprüsü. |
| `src/renderer/src/components/planner/PlannerQuestionHost.tsx` ve `plannerQuestionQueue.ts` | Planner clarification sorularının global kuyruk ve cevap akışı. |
| `src/renderer/src/screens/projects/detail/taskExport.ts` | Run workspace'e taşınan Task.md/Task.json/Task.toon, project group ve plan guide bağlamı. |
| `src/main/services/task-json-import.ts` | Planlanmış task JSON'un normalize edilmesi ve import sınırları. |
| `src/main/services/project-group.service.ts` ve `src/db/repositories/group-repo.ts` | Proje grubu adı/açıklaması, üyelik validasyonu ve tek projeyi tek grupta tutma kuralı. |
| `src/renderer/src/screens/project-groups/*` | Proje grubu liste, düzenleme ve detay ekranları; grup düzeyi progress ve task görünümü. |

## Plan Pipeline Yaşam Döngüsü

1. Taslak oluşturma: Renderer tarafında `PipelineDraft` localStorage içinde tutulur. Ad, proje seçimi, task havuzu, grup listesi ve run mode burada yaşar. Kalıcı kayıt oluşmadan önce bu taslak yalnızca tarayıcı durumudur.
2. Kapsam seçimi: Proje listesi ve task listesi IPC üzerinden yüklenir. Done/closed/completed statüler UI tarafında elenir, fakat servis tarafı yalnızca project-task kapsamını ve duplicate task atamasını doğrular.
3. Gruplama: Seçili tasklar bir pipeline grubuna atanır. Aynı task UI'da tek gruba taşınır; servis tarafı da duplicate task id kontrolü yapar.
4. Kaydetme: `createFromGroups` her dolu grubu ayrı `PlanPipelineRecord` satırı olarak yazar. Ortak bir pipeline batch/run id yoktur; ilişki `sourceDraftName`, `projectIds`, `groupOrder` ve aynı yaratılma zamanı ile dolaylı kurulur.
5. Onay ve run mode: `questioned` mod UI'da `waiting/blocked` davranışı üretir; `silent` doğrudan `running` yapar. Bu mod henüz gerçek Codex plan/run köprüsünü çağırmaz.
6. Çalıştırma: Kayıtlı pipeline ekranında başlatma sadece status'u `running` yapar. Yerel taslakta interval ile progress simülasyonu yapılır; kayıtlı kayıtlar için task bazlı gerçek ilerleme veya OMC run entegrasyonu yoktur.
7. Retry/hata: Retry count, status, progress ve lastError alanları patch edilir. Retry, execution id veya önceki deneme geçmişini ayrı modellemez.
8. Özet/context aktarımı: `summaryContext` alanı kayıt modelinde var; yerel taslak simülasyonunda üretilir. Kayıtlı pipeline akışında önceki grup özetinin sonraki Codex plan/run prompt'una enjekte edildiği bir bağ yoktur.
9. Review geçişi: Görev run akışında `.omc` helper `ready-for-review` ile task status geçişi yapar. Plan Pipeline kayıtlarında review geçişine veya task lifecycle paneline bağlı bir finalizasyon noktası yoktur.

## Grup Yapısı Ayrımı

Pipeline grubu, bir pipeline taslağı içindeki yürütme aşamasıdır. Sıra, task id listesi, run mode, progress, retry ve context özeti taşır. Amacı aynı planlama/yürütme hedefinde taskları aşamalara bölmektir.

Proje grubu, organizasyon altında projeleri birbirine bağlayan kalıcı bir üst bağlamdır. Tek proje yalnızca bir proje grubuna üye olabilir; amacı ajanların ve kullanıcıların ilişkili projeleri ortak bağlamda görmesidir.

Bu iki grup kavramı şu anda doğrudan çakışmıyor, ancak adlandırma ve veri ilişkisi belirsiz: Plan Pipeline seçimi projectIds ile çalışıyor, fakat proje grubu seçimi veya "bu pipeline şu proje grubundan üretildi" alanı yok. `taskExport.ts` proje grubunu task context'e koyabiliyor; buna karşın Plan Pipeline context aktarımı bu kaynaktan faydalanmıyor.

Önerilen hiyerarşi:

1. Project Group: kalıcı organizasyon/proje bağlamı.
2. Plan Pipeline Batch: tek kullanıcı niyetiyle oluşturulan pipeline üst kaydı.
3. Pipeline Stage Group: batch içindeki sıralı grup.
4. Task Run: stage içindeki gerçek Codex plan/run denemesi.
5. Attempt: retry geçmişi, hata, çıktı ve özet birimi.

## Başlıca Boşluklar ve Riskler

- Kalıcı modelde batch/run üst kaydı yok. Her grup ayrı satır olduğu için aynı pipeline'a ait grupları güvenilir şekilde toplamak, sırayla kilitlemek ve bütünsel tamamlanma hesaplamak zorlaşıyor.
- Status state machine servis tarafında korunmuyor. `updateState` herhangi bir status patch'ini kabul ediyor; pending -> completed, failed -> completed veya cancelled -> running gibi geçişler engellenmiyor.
- UI progress simülasyonu gerçek task, Codex run, planner clarification veya ready-for-review akışına bağlı değil. Bu yüzden kullanıcı "çalışıyor" gördüğünde gerçek iş başlamamış olabilir.
- `questioned` run mode ile planner clarification akışı ayrı sistemler. Pipeline grubu onayı, `PlannerQuestionHost` ve task planning conversation ile bütünleşmiyor.
- `summaryContext` alanı var ama gerçek kayıtlı pipeline akışında üretilmiyor ve sonraki aşamaya aktarılmıyor.
- Servis, done/closed task seçimini engellemiyor; bu kural UI'da var ama API çağrısı doğrudan yapılırsa aşılabilir.
- Proje grubu ve pipeline grubu dili aynı "group" kavramını kullanıyor. Ekranlarda amaç farkı anlatılıyor, fakat veri modelinde `projectGroupId` veya `pipelineBatchId` gibi açık ayrım yok.
- Dokümantasyon boşluğu var. Kullanıcı-facing Planning dokümanı Plan Pipeline'ı kapsam dışı bırakıyor; geliştirici-facing lifecycle dokümanı hiç yok.

## Uygulanabilir İyileştirme Planı

### 1. Pipeline batch modelini ekle

`plan_pipeline_batches` tablosu ve paylaşılan `PlanPipelineBatch` tipi eklenmeli. Batch; ad, projectIds, isteğe bağlı projectGroupId, runMode, status, createdByName ve aggregate progress taşımalı. Mevcut `plan_pipeline_records` stage tablosu batchId ile bağlanmalı. Geriye dönük migration, aynı `sourceDraftName + createdAt` kümelerini batch'e taşıyabilir.

Kabul notları:
- Listeleme API'si batch ve stage'leri birlikte döndürür.
- Stage sırası batch içinde tekil ve deterministiktir.
- Eski kayıtlar migration sonrası kaybolmaz.

### 2. Servis tarafı state machine kur

`PlanPipelineService.updateState` patch yerine açık aksiyonlar sunmalı: `startStage`, `pauseStage`, `approveStage`, `failStage`, `retryStage`, `completeStage`, `cancelBatch`. Her aksiyon izin verilen mevcut status setini, progress aralığını, retry artışını ve completedAt davranışını doğrulamalı.

Kabul notları:
- Geçersiz status geçişleri validation hatası döndürür.
- Completed/cancelled stage tekrar başlatılamaz; retry yalnız failed stage için çalışır.
- Batch aggregate status stage durumlarından türetilir.

### 3. Pipeline'ı gerçek task plan/run köprüsüne bağla

Stage başlatıldığında seçili tasklar için mevcut `task.service.ts` planning/run mekanizmaları sırayla çağrılmalı veya en azından run command queue modeli oluşturulmalı. `questioned` mod, pipeline onayı ile planner clarification cevabını karıştırmadan "stage başlamadan kullanıcı onayı" anlamına gelmeli; task içi clarification yine `PlannerQuestionHost` üzerinden ilerlemeli.

Kabul notları:
- Stage run başlatma gerçek task activity üretir.
- Task bazlı runId/conversationId stage attempt altında izlenir.
- Stage progress task activity ve terminal completion sinyallerinden hesaplanır; simülasyon kaldırılır veya yalnız demo modu olarak ayrılır.

### 4. Context ve özet aktarımını standartlaştır

Her stage sonunda `summaryContext` task çıktıları, değişiklik özeti, hata özeti ve kabul notlarından üretilmeli. Sonraki stage prompt'una bu özet "previous stage context" olarak eklenmeli. Proje grubu varsa task export context'indeki project group bilgisi pipeline context ile birlikte taşınmalı.

Kabul notları:
- Completed stage summary boş kalmaz; kaynak task/run id'leriyle izlenebilir.
- Sonraki stage prompt'u önceki stage summaryContext'ini içerir.
- Project group bağlamı pipeline batch seviyesinde görünür.

### 5. UI dilini ve dokümantasyonu netleştir

Plan Pipeline ekranı "pipeline stage grubu" ve "proje grubu" kavramlarını ayrı isimlerle göstermeli. `src/renderer/src/constants/codex-docs.ts` içine Plan Pipeline için ayrı doküman bölümü veya bu markdown'dan türeyen kullanıcı-facing içerik eklenmeli. Runs ekranı batch -> stage -> task -> attempt hiyerarşisini göstermeli.

Kabul notları:
- Plan Pipeline dokümanı kullanıcıya taslak, kayıt, onay, gerçek run, retry ve review ilişkisini açıklar.
- UI'da kayıtlı stage'ler yalnız son yaratılan gruplarla sınırlı görünmez; batch seçimi yapılabilir.
- Proje grupları ekranı ile pipeline grupları aynı terimle karışmaz.

## Sonraki Uygulama Koşusu İçin Önerilen Alt Görevler

1. Kalıcı batch/stage veri modelini tasarla ve migration ekle: mevcut kayıtları koruyarak batchId, aggregate status ve projectGroupId alanlarını modele bağla.
2. PlanPipelineService API'sini aksiyon tabanlı state machine'e dönüştür: create/list/update testlerini geçiş doğrulamaları ve duplicate/done task kontrolleriyle genişlet.
3. Renderer pipeline ekranlarını batch hiyerarşisine geçir: taslak kaydetme, kayıtlı batch listesi, stage detayları ve runs ekranı aynı API modelini kullansın.
4. Stage execution adapter ekle: stage tasklarını mevcut planner/run köprüsüne sırayla bağla, progress ve retry bilgisini gerçek activity/attempt verisinden üret.
5. Context aktarımı ve dokümantasyonu tamamla: `summaryContext`, project group bağlamı, kullanıcı-facing Plan Pipeline dokümanı ve kabul notlarını güncelle.

## Kabul Notları

- Repo içindeki ilgili kaynaklar tespit edildi ve kaynak haritası çıkarıldı.
- Pipeline lifecycle; taslak, seçim, grup, kayıt, onay, run mode, retry, hata, context ve review geçişleriyle ayrı ayrı irdelendi.
- Proje grubu ile pipeline grubu ayrımı ve önerilen hiyerarşi açıklandı.
- Boşluklar uygulanabilir refactor başlıklarına ve sonraki koşuya aktarılabilir alt görev planına dönüştürüldü.
