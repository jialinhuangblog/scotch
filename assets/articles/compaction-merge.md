---
title: "merge k sorted lists：處理大量寫入的資料庫，compaction 時很常見的演算法"
slug: compaction-merge
date: 2026-09-01
subtitle: "只准 append 的系統，檔案只會越積越多，最後都得回答 k 個有序檔案怎麼合成一個。"
chapter: "storage"
tags: [compaction, lsm-tree, k-way-merge, cassandra, clickhouse, lucene, storage]
related: [storage-internal, the-log]
---

# merge k sorted lists：處理大量寫入的資料庫，compaction 時很常見的演算法

一台 Cassandra 跑了一天，資料目錄底下有 47 個 SSTable 檔案。查詢 `user_id=8821` 這一列，可能含這個 key 的檔案都得打開，因為那一列的不同欄位可以分散在不同的檔案裡。

隔天早上再看，剩 6 個。

中間跑的是 compaction。

---

## 為什麼會累積成 47 個

[LSM Tree](chunk://lsm-tree) 的寫入路徑到 SSTable 就結束了。memtable 滿了就 flush 成一個檔案，檔案寫完之後 immutable，不再修改。UPDATE 不是回頭去改舊檔案，是在新的 memtable 寫一份新版本，之後 flush 成另一個檔案。DELETE 也一樣，寫一個 tombstone 進去。

所以同一個 key 會變成這樣：

```
SSTable-001:  user_id=8821, name="Alice",   email="a@x.com",  ts=T1
SSTable-014:  user_id=8821, name="Alice_2",                   ts=T2   ← UPDATE 只改了 name
SSTable-039:  user_id=8821, tombstone（整列刪除）              ts=T3
```

三個版本，散在三個檔案。這裡不能停在「找到最新的那個就好」，因為 Cassandra 的 UPDATE 只寫被改到的欄位，衝突解決是逐欄位比 writetime。同一列的 name 可能在 SSTable-014，email 還留在 SSTable-001。讀一整列要把所有可能含這個 partition 的 SSTable 都打開，逐欄位挑出 timestamp 最大的那份，再拼回一列。

[Bloom filter](chunk://bloom-filter) 可以跳過大部分不含這個 key 的檔案，但檔案數量本身就是成本，每個 SSTable 都有自己的 index 跟 bloom filter 常駐記憶體，47 個就是 47 份。

寫入越快，檔案累積越快。append-only 讓寫入變成 sequential write，代價就在這裡。

---

## 全部讀進記憶體再排序，為什麼不行

每個 SSTable 內部已經按 key 排好序，Sorted String Table 的名字就是這個意思。合併之後也必須保持有序，不然讀取時的 binary search 就用不了。

最直覺的做法是全部讀進記憶體，接在一起排序一次，再寫出去。

不行。一個 SSTable 幾百 MB 很常見，47 個加起來好幾 GB。compaction 是背景工作，不能把整台機器的記憶體用完，不然前景的讀寫就沒得跑了。

而且這樣做把一個既有的條件浪費掉了，每個檔案本來就已經有序。從頭排序一次是 O(N log N)，但輸入本來就有序，不需要這麼多。

---

## 從三個檔案開始

先把檔案數縮到 3，資料縮到看得完：

```
A: 1, 4, 9
B: 2, 5
C: 3, 8
```

輸出要是 `1, 2, 3, 4, 5, 8, 9`。

每一步只要問，現在三個檔案最前面的那筆，哪個最小？

第一步，A 的最前面是 1、B 是 2、C 是 3。最小的是 1，寫出去。A 往前推進一格，最前面變成 4。

第二步，A=4、B=2、C=3。最小的是 2，寫出去。B 推進，最前面變成 5。

每寫出一筆，只有一個候選被替換掉，其他 k−1 個候選完全沒動，所以下一步不需要重新比較全部。min heap 提供的剛好就是這兩個操作，取出最小值 O(log k)，塞一筆新的進去也是 O(log k)。

完整流程：

```
heap 初始: {1(A), 2(B), 3(C)}      ← 每個檔案的第一筆

pop 1(A)  → 輸出 1，去 A 取下一筆 4，push
heap:      {2(B), 3(C), 4(A)}

pop 2(B)  → 輸出 2，去 B 取下一筆 5，push
heap:      {3(C), 4(A), 5(B)}

pop 3(C)  → 輸出 3，去 C 取下一筆 8，push
heap:      {4(A), 5(B), 8(C)}

pop 4(A)  → 輸出 4，去 A 取下一筆 9，push
heap:      {5(B), 8(C), 9(A)}

pop 5(B)  → 輸出 5，B 沒有下一筆了，不 push
heap:      {8(C), 9(A)}

pop 8(C)  → 輸出 8，C 也沒了
heap:      {9(A)}

pop 9(A)  → 輸出 9，A 也沒了
heap:      {}                       ← 結束
```

輸出 `1, 2, 3, 4, 5, 8, 9`，有序。

---

## 代價

N 是總資料筆數，k 是檔案數。

每一筆資料進 heap 一次、出 heap 一次，各 O(log k)，總共 O(N log k)。

演算法本身的空間是 O(k)，heap 裡同時只有 k 筆，47 個檔案就是 47 筆。檔案用 streaming 讀取，不需要整份載入。

跟「全部讀進來再排序」比較，時間從 O(N log N) 變成 O(N log k)，N 是幾億、k 是幾十；空間從跟 N 成正比變成跟 k 成正比。

O(k) 是演算法的空間，不是 compaction 行程實際佔的記憶體。真的跑起來還有每個輸入檔案的讀取緩衝、輸出的寫入緩衝，以及正在建立的新 bloom filter，最後那個的大小跟 N 走，不跟 k 走。k-way merge 拿掉的是「必須把全部資料同時放在記憶體裡」這個限制，不是把記憶體用量壓到某個固定數字。

這個演算法叫 k-way merge。

---

## 寫成 code 就是 merge k sorted lists

```ts
type Cursor = { value: number; fileIdx: number };

function kWayMerge(files: number[][]): number[] {
  const heap = new MinHeap<Cursor>((a, b) => a.value - b.value);
  const pos = files.map(() => 0);

  // 每個檔案的第一筆先進 heap
  files.forEach((f, i) => {
    if (f.length > 0) heap.push({ value: f[0], fileIdx: i });
  });

  const out: number[] = [];
  while (heap.size > 0) {
    const { value, fileIdx } = heap.pop();
    out.push(value);

    pos[fileIdx] += 1;
    const next = files[fileIdx][pos[fileIdx]];
    if (next !== undefined) heap.push({ value: next, fileIdx });
  }
  return out;
}
```

heap 裡放的不是單純的數值，是 `{ value, fileIdx }`。`fileIdx` 不能省，因為 pop 出來之後要知道回哪個檔案取下一筆。

上面這段 code 就是 LeetCode 第 23 題 merge k sorted lists，題目給 k 條各自已經遞增的 linked list，要合成一條遞增的。那題用 ListNode，`node.next` 直接代替了 `fileIdx`，同一個結構換個寫法而已。

---

## 真實的 compaction 比那一題多什麼

重複的值，merge k sorted lists 兩個都要，compaction 只能留一個。

那題的範例輸入是 `[[1,4,5],[1,3,4],[2,6]]`，答案是 `1,1,2,3,4,4,5,6`。兩個 1 都輸出，因為那兩個 1 沒有身分，就是兩筆各自獨立的資料。compaction 的 `user_id=8821` 在三個 SSTable 都出現過，pop 出來會連續遇到三次，但那是同一列的三個版本，只能留一份。差別在語意，不在輸入長什麼樣。

留哪一份？比 cell 的 writetime，大的勝出，而且是逐欄位比。這個 timestamp 寫在資料本身裡，不在檔名上。Cassandra 4.1 之後 SSTable 的檔名用 ULID 取代了遞增的 generation 編號，而且就算還是遞增編號也不能拿來判新舊，因為 compaction 剛寫出來的大檔案會拿到最大的編號，裡面裝的卻是舊資料。`fileIdx` 只有一個用途，就是知道 pop 之後回哪個檔案取下一筆。

第三個版本是 tombstone，代表這一列已經被刪除。合併時的處理是整組丟掉，一筆都不輸出。

但 tombstone 本身不能馬上丟掉。

那要是這節點的 tombstone 先消失了呢？跨節點的另一個副本還沒收到刪除指令，下次 read repair 就把那筆舊資料當成有效資料同步回來，被刪掉的資料復活。所以 Cassandra 有 `gc_grace_seconds`，預設 864000 秒也就是十天，tombstone 要活過這段時間才有資格被丟掉。

熬過十天還不夠，同一台機器上也會復活。**這一輪 compaction 必須同時涵蓋所有含有更舊資料的 SSTable。** 假設 tombstone 在 SSTable-039，`ts=T1` 的舊資料在 SSTable-001，而這一輪只挑了 014 跟 039 來合併。丟掉 tombstone 之後，001 裡的舊資料沒有東西蓋住它，下一次讀取就會讀到 `name="Alice"`。一個副本節點都不用牽扯進來。

所以「哪幾個檔案放進同一個 heap」不只決定磁碟 IO，也決定 tombstone 什麼時候清得掉。這條在後半的策略節還會再出現。

還有一個差別在輸出端。那題的輸出是一條 list，compaction 的輸出是一個檔案，而且要邊寫邊建立 index block 跟 bloom filter，寫完才能給讀取路徑使用。

---

## 為什麼這幾個系統長得一樣

Cassandra 最早是 Facebook 為了收件匣搜尋做的，那個場景寫入遠多於讀取，而且要能水平擴充到幾百台。ClickHouse 來自 Yandex 的網站流量分析，每秒幾十萬筆事件持續寫入，同時還要跑聚合查詢。Lucene 解的是全文檢索，[inverted index](chunk://search-inverted-index) 建好之後要改一個詞很貴，所以寫入變成產生新的 segment。

三個場景不一樣，但它們面對的限制是同一組：

```
寫入要快      → 只能 sequential write → 資料只能 append 進新檔案
新檔案要能查   → 檔案內部必須有序
檔案數量無上限 → 必須定期合併
合併要保持有序 → 而且不能把全部資料載入記憶體
```

推到最後一行，把幾個有序檔案合成一個有序檔案，用的就是 k-way merge。不是三個團隊互相抄，是同一組限制推出同一個解。至於一次 merge 裡有多少資料真的要按順序合、有多少可以繞過去，三邊的答案不一樣，下面拆。

這個推導有前提，就是這幾個檔案的 key range 必須交錯。前提不成立的時候，最快的合併是不合併。TWCS 讓整個時間窗的資料一起過期，過期就刪掉整個檔案，沒有任何 key 要比較。Leveled compaction 也有 trivial move 這條捷徑，要搬到下一層的檔案如果 key range 跟下一層完全不重疊，直接掛過去就好，不讀不寫。這兩條都繞過了 heap。

真的需要合併時，三邊的名字不同，做的是同一件事：

| 系統 | 不可變的單位 | 合併的名字 | 預設策略 |
|---|---|---|---|
| Cassandra | SSTable | compaction | SizeTieredCompactionStrategy |
| ClickHouse | part（按 ORDER BY key 排序）| merge | MergeTree 的背景 merge |
| Lucene / [Elasticsearch](chunk://elasticsearch) | segment | merge | TieredMergePolicy |

ClickHouse 甚至把它寫進了引擎名字，MergeTree。

不過這張表會讓人以為一次 merge 就是一個動作，不是。ClickHouse 跟 Lucene 都把一次 merge 的資料分成兩份，只有帶排序鍵的那一份進 heap，另一份用複製或重排搬過去。Cassandra 沒有這一份，稍後講為什麼。

ClickHouse 最明顯，因為它是欄式的。它有兩條 merge 路徑，horizontal 跟 vertical，`enable_vertical_merge_algorithm` 預設就是 1。走 vertical 的時候只有 ORDER BY 的欄位進合併排序，過程中把「輸出的第幾列來自哪個 part」寫成一份 rows_sources；其餘欄位（原始碼裡叫 `gathering_columns`）一根一根讀進來，照那份 rows_sources 重排寫出，一次比較都不做。

切到 vertical 的門檻有兩個。列數那個比的是**這一輪 merge 所有來源 part 的列數加起來**要到 `vertical_merge_algorithm_min_rows_to_activate`（預設 131072），不是單一 part；欄位那個比的是排序鍵以外的欄位有 `vertical_merge_algorithm_min_columns_to_activate` 根以上（預設 11）〔預設值出自 clickhouse.com 的 merge-tree-settings；比較的是哪個列數是我從 `MergeTask.cpp` 的 `chooseMergeAlgorithm` 的二手說明讀來的，那段原始碼我沒讀到〕。

所以走哪一條，決定權在寫入端一次送多少列。ClickHouse 自己的建議是 "inserting data in batches of at least 1,000 rows, and ideally between 10,000–100,000 rows"，而單次 flush 的資料要超過 `max_insert_block_size`（預設約一百萬列）才會被拆成多個 part〔SRC: clickhouse.com/docs/best-practices/selecting-an-insert-strategy〕。

一批十萬列進來就是一個十萬列的 part，兩個湊在一起就過十三萬，第一輪 merge 就走 vertical。一批一千列的話，要湊到 131 個 part 才過門檻，前面那幾輪走 horizontal，整份資料一起比較。所以 vertical 是常態還是例外，這篇答不了，它跟著寫入端的 batch 大小走。

Lucene 的分法一樣。term dictionary 那一層真的跑 k-way merge，`MultiTermsEnum` 拿一個 `TermMergeQueue extends PriorityQueue<TermsEnumWithSlice>`，按 term 的字典序合併各 segment 的 terms enum；這裡的共同 key domain 是 term，不是 doc id，所以 doc id 在合併過程被重新編號不影響比較。但 stored fields 走另一條，`Lucene90CompressingStoredFieldsWriter` 在來源 segment 沒有刪除（`mergeState.liveDocs[readerIndex] == null`）、壓縮設定又一致的時候會選 `MergeStrategy.BULK`，整個 chunk 以壓縮格式直接複製，連解壓縮都省了。

Cassandra 沒有這個分法，整份資料都經過比較。它的 SSTable 是一列的所有欄位存在一起，compaction 讀進來的每一格都跟著 partition key 走過 merge iterator，沒有哪一部分繞得過去。

分不分得開，看的是儲存格式有沒有把資料切成可以單獨搬的單位。ClickHouse 一個欄位自己一份，Lucene 的 stored fields 自己一份壓縮 chunk，那些單位可以離開排序流程自己走。Cassandra 沒有這種單位，所以省不掉那些比較。

所以能講的是排序那一層。不參與排序的酬載，欄式跟 segment 式的系統會把它抽出來複製或重排，能省的比較就省掉。

[The Log](article://the-log) 那篇講的是 append-only 這個做法為什麼在 Raft、Kafka、WAL、CDC 到處出現。compaction 是它的另外一半。只准 append 的系統一定要有人負責合併，不然檔案數量沒有上限。

---

## 什麼時候合併，要合併哪幾個

演算法確定了，但 47 個檔案不會一次全部放進同一個 heap。要合併哪幾個、什麼時候合併，由策略決定。策略一選下去，讀、寫、空間的成本比例就定了，tombstone 什麼時候清得掉也跟著定了。

假設一張 time-series 表，每天進兩億筆，一列大約 50 bytes，查詢大多集中在最近一小時。跑三個月是 1.8×10¹⁰ 列，落地大約 900GB。後面所有級距數跟層數都用這個 900GB 算。

**一開始用預設的 STCS（SizeTiered）**。規則是把大小相近的 SSTable 湊成一組，大小落在某個 bucket 平均值的 50% 到 150% 之間就歸進那個 bucket，合併的寬度由兩個門檻夾住。累積到 `min_threshold`（預設 4）個才會觸發，一輪最多吃 `max_threshold`（預設 32）個〔SRC: cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/stcs.html〕。所以最窄的情況是四個 500MB 的合成一個 2GB，四個 2GB 的再合成 8GB，一輪一輪往上翻；最寬的情況是三十二個 500MB 一輪就合成 16GB，同樣的尺寸用窄的走法要爬兩三輪。實際落在哪，看的是 compaction 排到這個 bucket 的時候裡面累積了幾個，也就是排程頻率對上 flush 速率。

寫放大（write amplification）低，因為每筆資料被重寫的次數少。

**跑了三個月，磁碟用量變成實際資料的兩倍多**。原因是 STCS 會留下幾個很大的 SSTable，同一個 key 的舊版本留在大檔案裡，要等到「再湊滿一組同尺寸的大檔案」才會被清掉，而大檔案要湊滿很久。

tombstone 卡在同一個地方，而且更嚴重。前面說過丟 tombstone 要涵蓋所有含更舊資料的 SSTable，STCS 只挑同一個尺寸級距的檔案來合併，那個級距天生就不會涵蓋躺在大檔案裡的舊版本。結果是 tombstone 跟它要刪的資料兩份都留著，佔的空間比刪除前還多。

更麻煩的是合併那一刻還需要跟輸入等量的空閒磁碟，因為新舊檔案會同時存在。

同時 p99 讀取延遲也降不下來。一個 key 可能同時存在於好幾個 bucket 的檔案裡，bloom filter 對這些檔案沒有作用，因為那個 key 真的在裡面。

**換成 LCS（Leveled）**。規則完全不同。每一層的檔案大小固定（`sstable_size_in_mb`，預設 160），而且 L1 以上同一層裡的 SSTable，key range 保證不重疊。查詢一個 key，L1 以上每一層最多只讀取一個檔案。

層數由每層的目標容量決定。L1 的目標容量是 `sstable_size_in_mb` 乘上 `fanout_size`（預設 10），也就是 1.6GB，往上每層再乘十，L2 16GB、L3 160GB、L4 1.6TB。900GB 落在 L4 還沒填滿，所以是四層。

L0 不算在「一層一個檔案」裡面。memtable flush 出來的 SSTable 先落在 L0，那一層「SSTables are not guaranteed to be non-overlapping」，而且要累到超過 32 個才會在 L0 內部觸發一輪 STCS〔SRC: cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/lcs.html〕。所以查詢要開的檔案數是 L0 現有的數量再加四。compaction 跟得上的時候 L0 只有幾個，總數個位數，比 STCS 的十幾個好；跟不上的時候光 L0 就能到 32 個，比換過來之前還糟。而 L0 跟不上正是下一段要講的後悔情境。

**代價是寫放大大幅上升**，而且幅度不是「升幾層就重寫幾次」。把一個檔案從 L(n) 推到 L(n+1) 的時候，下一層所有 key range 跟它重疊的檔案都要一起讀出來重寫。層與層的容量比是 10，所以重疊的檔案數量也是 10 的量級。每一層的寫放大最壞等於 fanout，實務上會比 fanout 少一些〔RocksDB 的 compaction 文件寫的是 "The per-level write amplification is equal to the fanout in the worst case, but it tends to be less than the fanout in practice"〕。900GB 是四層，累積下來就是幾十倍，不是四倍。

跟 STCS 對照要用同一個單位跟同一個資料量，都算總量、都用 900GB。STCS 的資料每升一個尺寸級距被重寫一次，級距數的底就是合併寬度，而寬度落在 4 到 32 之間。500MB flush、900GB 總量，也就是 1800 份的話：寬度 4 是 log₄(1800) ≈ 5.4 個級距，寬度 32 是 log₃₂(1800) ≈ 2.2 個。總寫放大在 2 到 5 之間，個位數。LCS 在同樣的 900GB 是四層，每層最壞乘上 fanout 再累加，落在幾十倍。區間的兩端都跟 LCS 差一個量級，這個對照不靠寬度落在哪。

〔RocksDB 那份文件另外寫 tiered 的 "per-level write amplification is 1"，那是對 tiered 這一類的敘述，不是 Cassandra STCS 的量測，而且 STCS 的結構是尺寸 bucket 不是層，單層數字搬過來會被讀成總量。〕

**換成 LCS 之後什麼時候會後悔？** 寫入量再往上加，compaction 追不上 flush 的速度。`nodetool compactionstats` 的 pending tasks 持續累積不下降，L0 的 SSTable 數量一直增加，那就是徵兆。這時候換過來的理由自己失效了。讀取要開的檔案數變成 L0 那一堆加四，比原本的 STCS 還多，而寫放大變高的代價已經承受了。到這一步可以加機器把寫入分散掉，可以換回 STCS 接受讀取變慢，也可以回頭檢查資料的寫入與刪除模式。

最後那條在 time-series 上最有效，但適用條件很窄。資料要只按時間 append，而且**過期靠寫入時帶的 TTL，不是靠排程跑 DELETE**。滿足這個條件就用 TWCS（TimeWindow），按時間窗切分 SSTable，同一個窗內用 STCS，窗關閉之後就不再跟其他窗合併。整個窗的資料一起到期，整份 SSTable 丟掉，一次 merge 都不用跑。

「一起到期」不代表一到期就丟。TTL 到期的資料本身就算 tombstone，所以 `gc_grace_seconds` 照算，`CompactionController.getFullyExpiredSSTables` 比的是 `candidate.getMaxLocalDeletionTime() < gcBefore`，而 `gcBefore` 是現在減掉 gc grace。熬過那段時間之後還要確認這份 SSTable 沒有蓋住別的 SSTable 裡的資料，跟前面 tombstone 那一節講的本機條件同一回事。Cassandra 有一個叫 `unsafe_aggressive_sstable_expiration` 的選項可以跳過後面這道檢查，官方文件對它的說明是 "Expired SSTables will be dropped without checking its data is shadowing other SSTables"，並且標成 "a potentially risky option that can lead to data loss or deleted data re-appearing"，還要另外用 JVM 參數才打得開。有一個選項專門用來不做這道檢查，就代表預設會做。照磁碟容量規劃的時候，窗一到期空間不會馬上回來。

排程 DELETE 在 TWCS 底下反而最糟。DELETE 產生的 tombstone 帶著現在的時間戳，會落進**現在**這個窗的 SSTable，而要刪的資料在**舊**窗裡。窗關閉之後兩個窗不再合併，tombstone 永遠碰不到它要刪的那份資料，兩邊都清不掉。要走這條路就得改成 TTL，不然 TWCS 是反效果。

---

三種策略把讀、寫、空間三邊的成本分配得不一樣，就是 [storage-internal](article://storage-internal) 最後提到的 RUM 取捨的具體樣子。排序那一層用的一直是同一段 k-way merge，策略決定的是哪些檔案要進這一輪的排序、哪些整份跳過。同一份檔案裡還有另一層分法，欄式跟 segment 式的系統只讓帶排序鍵的那部分進 heap，其餘的照 permutation 重排或整塊複製。
