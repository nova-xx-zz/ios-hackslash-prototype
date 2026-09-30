# 詳細設計書

> 更新日: 2026-09-30。現行実装の参照基点: `8f0e153`。
> 本書では「現行実装」「採用済み・未実装」「将来構想」を区別する。
> **§6.4〜6.6（ギルドのお知らせ・予定表・起動順序）と§7（保存・機能ゲート）はこの更新の直後のコミットで実装済みとなった。** §6.1〜6.3（スキルツリー・ブック・極みのデータ設計）は内容決定待ちのため未実装のまま。実装は`data/announcements.js`・`data/roadmap.js`（設計上の`.json`ではなく`js/data.js`と同じ素のJSグローバル定義）、`js/game.js`の`FEATURE_FLAGS`・お知らせ関連関数・`saveGame()`/`loadGame()`のschemaVersion対応を参照。

対象コード: `js/data.js`, `js/game.js`, `index.html`, `data/announcements.js`, `data/roadmap.js`（現行参照コミット `8f0e153` ＋ 基盤実装コミット）。§1〜5は現行設計、§6.4〜6.6・§7は実装済み、§6.1〜6.3は採用済み・未実装の拡張設計。

## 1. データ構造定義

### 1.1 キャラクターオブジェクト（`roster` の各要素）

`newCharacter(name, job, race, opts)` が生成する。

```js
{
  id: "c" + N,                 // 連番ID（nextCharSeqから発行）
  name, job, race,             // job は human キャラのみ意味を持つ（モンスターは null）
  subAbilityIds: [null, null], // サブアビリティ2枠（abilityId）
  jobLevels: {},               // { [jobId]: { level, exp, expToNext } } 転職してもレベル保持するための辞書
  skillActive: {},             // { [abilityId]: bool }  未設定はON扱い
  abilityPriority: {},         // { [abilityId]: 1|2|3 } 温存/通常/優先、未設定は2(通常)
  targetPriority: "weakest",   // "weakest" | "strongest" | "random"
  level, exp, expToNext,
  equip: { weapon: null, armor: null, accessory: null },
  atb, defending, alive,       // 戦闘用の一時状態（ロード時に毎回リセット）
  team: 0-3 | null,            // 所属チーム、null=控え
  isMonster: bool,
  hp, mp,                      // computeStats() のmaxHp/maxMpで初期化
}
```

- `isMonster: true` のキャラは `race` がモンスター種族ID（`slime`/`goblin`/`bat`/`wolf`）であり、`jobDef()` は `job` ではなく `MONSTER_JOBS[c.race]` を返す
- `jobLevels` は「そのジョブで実際にレベルを上げたことがあるか」の記録も兼ねており、サブアビリティ候補（`subAbilityCandidates()`）や上級職解放判定（`jobUnlocked()`）の判定に使われる

### 1.2 アイテムオブジェクト（`inventory` の各要素）

`rollItemDrop()` が生成する。

```js
{
  id: "item_" + N,
  name,                // "◯◯のレア度＋ベース名"（例: "レアの剣"）
  slot,                // "weapon" | "armor" | "accessory"
  stat,                // 付与するステータスキー（hp/mp/atk/mag/def/spd）
  value,               // round(base.base * rarity.mult)
  rarity,               // "n"|"r"|"sr"|"ur"|"lr"
  rarityColor,
  materialValue,        // 自動分解で得る強化石量
  plus: 0,               // 強化値（0〜99）
}
```

### 1.3 ダンジョン進行オブジェクト `run`（チームごとに独立、`teamRuns[team]`）

`startDungeon(teamIndex, id, opts)` で生成、`screen-battle` を離れても・他チームを表示中でも `finishRun()` まで保持される一時状態。4チームぶんが `teamRuns[0..3]` に同時に存在しうる。戦闘そのものの状態（敵配列）は `teamBattles[team]` に分離して保持する。

```js
{
  team,                   // 0-3。このrunがどのチームのものかを表す
  dungeon,                // DUNGEONS の要素
  battleIndex,             // 0-origin。最後の要素がボス戦
  finished, wiped,
  buffs: { atk, mag, def, spd },   // 石碑イベントで加算される割合バフ（このダンジョン中のみ）
  expTotal, levelUps, abilityUnlocks, defeatedTamable,
  drops,                   // 確定済みドロップ（踏破時のみpendingDropsから移される）
  pendingDrops,             // 踏破するまで確定しない保留ドロップ
  disassembleCount, materialGained,
  autoDisassemble,          // 出撃時点(startDungeon呼び出し時)の自動分解ON/OFFのスナップショット
  autoDisassembleRarities,  // 同、対象レア度Setのスナップショット（settlePendingDropsで使用）
}
```

`autoDisassemble`/`autoDisassembleRarities` をrun自身にスナップショットしているのは、複数チームが同時に探索できるようになったことで、探索中に設定画面で自動分解の設定を変更しても「今まさに他チームが進行中の周回」の結果が変わってしまわないようにするため（詳細は基本設計書5.4節）。

### 1.4 セーブデータスキーマ（`localStorage["jobquest_save_v1"]`）

```js
{
  roster,                // キャラクターオブジェクトの配列をそのままJSON化
  inventory,
  activeTeam,
  clearedDungeons: [...clearedDungeons], // Setを配列化
  nextCharSeq,
  savedAt: Date.now(),
  autoRepeat: [           // チームごとの自動周回状態を並べた4要素配列（index = チーム番号）
    {
      active,              // このチームが自動周回稼働中か
      target, done,
      dungeonId: teamRuns[i] && teamRuns[i].dungeon ? teamRuns[i].dungeon.id : null,
    },
    // ...team 1, 2, 3
  ],
}
```

`teamRuns`/`teamBattles` そのもの（進行中の戦闘状態）は保存しない。ロード後は各要素の `autoRepeat[i].dungeonId` を使ってチームごとにオフライン進行の計算のみ行い、実際の戦闘再現はしない。`autoRepeat` が配列でない（旧バージョンの単一チーム時代のセーブデータ）場合は、`loadGame()` がオフライン進行の計算だけをスキップする（ロスター等の本体データは通常どおり復元される）。

## 2. 主要な計算式・アルゴリズム

### 2.1 ステータス計算（`computeStats(c)`）

```
growth = 1 + 0.12 * (level - 1)
maxHp  = round(job.base.hp  * growth * race.mult.hp)
maxMp  = round(job.base.mp  * growth * race.mult.mp)
atk    = round(job.base.atk * growth * race.mult.atk)
mag    = round(job.base.mag * growth * race.mult.mag)
def    = round(job.base.def * growth * race.mult.def)
spd    =        job.base.spd *          race.mult.spd   // 小数のまま保持（round しない）
```
各装備スロットの `itemEffectiveValue(item)` を対応ステータスに加算し、進行中のダンジョンで石碑バフが乗っていれば `atk/mag/def/spd` に `(1 + buff)` を掛ける（HP/MPは対象外）。

### 2.2 装備の実効値（`itemEffectiveValue(item)`）

```
bonus = ceil(plus * rarity.mult * 0.08)
effectiveValue = max(1, item.value + bonus)
```
+99到達時、レア度倍率(mult)が大きいほどボーナスが大きくなる（元の値の概ね4倍程度まで伸びる設計）。

### 2.3 経験値・レベルアップ（`expForLevel(level)`, `gainExp(c, amount)`）

```
expForLevel(level) = 30 + level * 15
```
`gainExp` は `exp` に `amount` を加算し、`exp >= expToNext` の間ループでレベルを1ずつ上げ、都度 `computeStats` でHP/MPを全回復、習得アビリティ（`reqLevel === level`）があれば通知リストに積む。ループ終了後、モンスターでなければ `jobLevels[job]` に現在の進行を書き戻す。戦闘勝利時（`onVictory`）とモンスター合成（`buildFusionTab`）の両方から共用される。

### 2.4 モンスター合成のEXP還元（`totalExpInvested(c)`, 合成確定処理）

```
totalExpInvested(c) = c.exp + Σ_{n=1}^{level-1} expForLevel(n)
```
選択した各素材モンスターについて `round(totalExpInvested(m) * 0.5)` を合計し、`gainExp(target, totalExpGain)` で対象モンスターへ一括付与する。素材は `roster` から削除（`splice`）される。

### 2.5 ATB戦闘ループ（4チーム並行）

定数: `ATB_RATE = 7`

```
loop(t):  dt = min(0.05, (t - lastT)/1000) * speedMult
          tick(dt)
tick(dt):
  for team i in 0..3:
    if teamBattles[i] && teamBattles[i].active: tickTeam(i, dt)
  updateTeamTabDots()   // 表示中でないチームの「探索中」タブ表示を毎フレーム追従させる

tickTeam(i, dt):
  run = teamRuns[i]; battle = teamBattles[i]
  for each alive member c of teamMembers(i):
    c.atb += computeStats(c).spd * ATB_RATE * dt
    if c.atb >= 100: performCharacterAction(run, battle, c); checkBattleEnd(run, battle)
  for each alive enemy e of battle.enemies:
    e.atb += e.spd * ATB_RATE * dt
    if e.atb >= 100: performEnemyAction(run, battle, e); checkBattleEnd(run, battle)
  if i === activeTeam: updateBattleDOM()   // DOM更新は表示中チームのみ
```
`speedMult` は `btnSpeedToggle` で 1 または 2 を切り替え、全チーム共通で速度に反映される（チームごとの個別速度設定はない）。`requestAnimationFrame` により毎フレーム呼び出され、`activeTeam`（画面に表示中のチーム）に関わらず4チーム全てのATBが等しく進行する。DOM更新（アクターカードのHP/MPバー、ログの追記）だけを表示中チームに限定することで、背後のチームの処理自体は止めずに描画コストを抑えている。

### 2.6 ダメージ・回復計算（`performCharacterAction`）

物理/魔法攻撃:
```
atkStat = isMagic ? stats.mag : stats.atk
mitig   = isMagic ? 0.15 : 0.3
dmg = max(1, round(atkStat * ability.power - target.def * mitig))
dmg = round(dmg * rand(0.9, 1.15))          // 乱数幅 ±
critChance = isMagic ? 0 : 0.1 + race.passive.critBonus (既定0)
if physical && random() < critChance: dmg *= 1.5
```
吸収（lifesteal = race.passive.lifesteal + ability.lifesteal）がある場合、`heal = max(1, round(dmg * lifesteal))` を行動者に加算する。

回復:
```
amount = max(1, round(stats.mag * ability.power * (1 + race.passive.healBonus) * rand(0.9, 1.1)))
```

敵の攻撃（`performEnemyAction`）:
```
dmg = max(1, round(e.atk - target.def * 0.4))
dmg = round(dmg * rand(0.9, 1.15))
dmg = max(1, round(dmg * (race.passive.dmgTakenMult || 1)))
```

### 2.7 敵エンカウント生成（`buildEncounter(dungeon, battleIndex)`）

```
mult  = (1 + (dungeon.level - 1) * 0.16) * (1 + battleIndex * 0.06)
count = min(5, 3 + floor(dungeon.level / 5))
```
`count` 体を `dungeon.pool` からランダム抽出。最終戦闘（`battleIndex === battles - 1`）ではボス（`dungeon.boss`）を `mult * BOSS_MULT(1.7)` で先頭に追加する。個体のステータスは `makeEnemy(template, mult, isBoss)` で `round(base * mult)` により算出。

### 2.8 オート戦闘AIの技選択（`chooseAction(c)`）

1. `availableAbilities(c)`（レベル習得済み＋サブアビリティ）のうち、ON（`isSkillActive`）かつMPが足りる技を候補にする
2. 回復技は無条件で候補にせず、`target === "single-ally"` なら「誰かがHP80%未満」、`all-ally` なら「誰かがHP70%未満」の場合のみ候補に残す（無駄撃ち防止）
3. 候補が0件なら通常攻撃（`BASIC_ATTACK`, power 1.0）
4. 候補は `(優先度降順, 要求レベル降順)` でソートし先頭を採用。優先度は `getAbilityTier`（既定2=通常）

ターゲット選択（`pickEnemyTarget`）は `targetPriority` に応じ、`weakest`=残HP最小、`strongest`=残HP最大、`random`=ランダム。回復対象（`pickAllyTarget`）は常に残HP割合最小の味方。

### 2.9 レア度抽選（`rollRarity()`）

重み付き抽選。`RARITIES` の `weight` 合計に対する一様乱数で選ぶ。

| key | name | mult | weight | material |
|---|---|---|---|---|
| n | ノーマル | 1.0 | 7100 | 5 |
| r | レア | 1.4 | 2200 | 20 |
| sr | スーパーレア | 2.0 | 650 | 80 |
| ur | ウルトラレア | 2.8 | 35 | 350 |
| lr | レジェンドレア | 4.0 | 15 | 1500 |

weight合計 = 10000。体感値として「1戦闘平均1.4個・1ダンジョン平均約5個のドロップ」を基準に、URは10周で遭遇率およそ15〜25%、LRは概ね100周に1個というペースになるよう調整されている。

### 2.10 装備強化の成功率（`enhanceSuccessRate(item)`）

```
rate = ENHANCE_CONFIG[rarity].baseRate * ENHANCE_CONFIG[rarity].decay ^ item.plus
rate = max(0.03, rate)   // 下限3%
```

| rarity | baseRate | decay | cost（強化石/回） |
|---|---|---|---|
| n | 0.90 | 0.995 | 3 |
| r | 0.75 | 0.990 | 8 |
| sr | 0.55 | 0.985 | 20 |
| ur | 0.35 | 0.978 | 60 |
| lr | 0.15 | 0.965 | 150 |

強化石は失敗しても消費される。`ENHANCE_MAX_PLUS = 99`。

### 2.11 オフライン進行シミュレーション

定数: `OFFLINE_MAX_MS = 8時間`, `OFFLINE_SEC_PER_BATTLE = 5秒`, `OFFLINE_SEC_PER_GAP = 2秒`, `OFFLINE_SEC_OVERHEAD = 2秒`

```
estimateOfflineRunSeconds(dungeon)
  = dungeon.battles * 5 + max(0, dungeon.battles - 1) * 2 + 2

offlineClearChance(dungeon)
  avgLevel = パーティ平均レベル
  = clamp(0.85 + (avgLevel - dungeon.level) * 0.03, 0.05, 0.98)
```

`runOfflineProgressForTeam(teamIndex, autoRepeatInfo, savedAt)`:
1. `elapsedMs = min(now - savedAt, OFFLINE_MAX_MS)`。5秒未満なら計算しない（何もしなかったとみなす）
2. `maxRunsByTime = floor(elapsedMs/1000 / estimateOfflineRunSeconds(dungeon))`
3. `runsToAttempt = min(maxRunsByTime, target - done)`
4. `runsToAttempt` 回、`simulateOfflineRun(dungeon, teamIndex)` を実行。全滅（`cleared:false`）が出た時点でループを打ち切り、それ以前の成功分のみ結果に反映する

`simulateOfflineRun(dungeon, teamIndex)` は `offlineClearChance` で踏破/全滅を1回抽選し、踏破時のみ全戦闘分のEXP・ドロップ（1戦闘あたり基本1個＋40%で追加1個、`rollItemDrop()`）・テイム抽選（該当種のいずれか1体、`tameChance`で判定）を通常プレイと同じ処理で反映する。全滅時は何も反映せずその周を打ち切る（オフライン中も「全滅時は持ち帰れない」仕様を維持）。

`runOfflineProgress(savedAutoRepeatArray, savedAt)` は上記をチーム0〜3それぞれに対して呼び出し、結果が出たチームの summary だけを配列にまとめて返す（1チームも該当しなければ `null`）。複数チームが同時にオフライン進行していた場合、`showOfflineModal()` がこの配列をチームごとのブロックとして並べて表示する。

### 2.12 道中イベント抽選（`rollDungeonEvent`）

戦闘間に `Math.random() < 0.6` で発生。発生時、重み付き抽選で4種から1つを選ぶ。

| イベント | weight | 効果 |
|---|---|---|
| 宝箱 | 40 | 65%でアイテム1個ドロップ（`gainItem`で保留扱い）、35%で空 |
| 罠 | 25 | 45%で全体に最大HPの10%ダメージ、55%で1人に最大HPの18%ダメージ（戦闘不能にはならない、`max(1, hp-dmg)`） |
| 泉 | 20 | 全員HP30%・MP25%回復 |
| 石碑 | 15 | atk/def/spdのいずれか1つに+12%（このダンジョン中のみ加算、複数回引くと積み上がる） |

### 2.13 ジョブ・種族テーブル要約

- 基本職6種はいずれも `base` ステータス・4アビリティ（reqLevel 1/5/10/15）を持つ。上級職6種は対応する基本職を `JOB_MASTER_LEVEL(=50)` まで育てると `jobUnlocked()` がtrueになる
- 種族パッシブは `PASSIVE_LABELS` に定義された5種類のいずれか1つ、または特性なし: `critBonus`（会心率+）, `dmgTakenMult`（被ダメ倍率）, `lifesteal`（吸収率）, `mpCostMult`（MP消費倍率）, `healBonus`（回復量+）
- モンスター種族（スライム/ゴブリン/コウモリ/ウルフ）はプレイヤー種族と同じ `RACES` 構造で定義され、`kind: "monster"` で区別。対応する `MONSTER_JOBS[key]` が固有のベースステータス・3アビリティを持つ

## 3. 画面別のロジック概要（関数マッピング）

| 画面/機能 | 主要関数 |
|---|---|
| タイトル | `renderTitle()` |
| 設定 | `btnHubSettings`で表示、`btnSettingsBack`で探索へ戻る |
| モンスター図鑑 | `renderDexScreen()`, `openDexDetail(key)` |
| パーティ編成 | `renderJobsScreen()`, `buildPartyRow()`, `buildMemberCard()`, `attachMemberDrag()`（ドラッグ移動） |
| キャラ作成 | `renderCreateScreen()`, `renderPickModal()`, `confirmCreate()` |
| キャラ詳細: 能力値 | `buildStatsTab()` |
| キャラ詳細: 装備 | `buildEquipSection()`, `autoEquip()`, `openEnhanceModal()` |
| キャラ詳細: スキル | `buildSkillTab()`, `buildSkillRow()`, `cycleAbilityTier()` |
| キャラ詳細: ジョブ/合成 | `buildJobTab()` → 人間は `buildJobCard()` 一覧、モンスターは `buildFusionTab()` |
| マップ | `renderMap()`, `selectDungeon()`, `renderDungeonInfo()` |
| 探索ドック | `renderDock()`, `renderAutoRepeatRow()`, `renderDisassembleFilter()`, `updateTeamTabDots()`（表示外チームのタブ状態を毎フレーム追従） |
| 戦闘進行（4チーム並行） | `startDungeon(teamIndex, id, opts)`, `startBattle(run)`, `loop()`/`tick()`/`tickTeam(i, dt)`, `onVictory(run, battle)`, `onDefeat(run)`, `finishRun(run, info)` |
| ロック判定 | `isTeamRunActive(i)`, `isTeamLocked(i)`（探索中または自動周回中のチームを判定し、編成/装備/スキル/転職/合成をロック） |
| ログ（チームごとに履歴保持） | `logEvent(teamIndex, ...)`, `logLine(teamIndex, ...)`, `renderLogFeed(teamIndex)`（タブ切替時にDOM再構築） |
| セーブ/ロード | `saveGame()`, `scheduleSave()`, `loadGame()` |
| オフライン進行（チームごとに独立計算） | `runOfflineProgress()`, `runOfflineProgressForTeam()`, `simulateOfflineRun()`, `showOfflineModal()` |

## 4. localStorage キー一覧

| キー | 型 | 用途 |
|---|---|---|
| `jobquest_save_v1` | JSON | メインセーブデータ（§1.4） |
| `jobquest_best_cleared` | 数値文字列 | 最大クリア済みダンジョン数 |
| `jobquest_material` | 数値文字列 | 強化石所持数 |
| `jobquest_autodisassemble` | `"0"`/`"1"` | 自動分解ON/OFF |
| `jobquest_autodisassemble_filter` | JSON配列 | 自動分解対象レア度キーの配列（既定 `["n","r"]`） |
| `jobquest_autorepeat_target` | 数値文字列 | 自動周回の選択回数（1/3/5/10/20/50のいずれか） |
| `jobquest_dex_seen` | JSON配列 | 図鑑で発見済みの敵テンプレートkey配列 |

すべての読み込みは `try/catch` で保護し、パース失敗時は既定値にフォールバックする（詳細は各キーに対応する初期化コードを参照）。

## 5. キャッシュバスティング運用

`index.html` の `css/style.css`・`data/announcements.js`・`data/roadmap.js`・`js/data.js`・`js/game.js` の読み込みには `?v=N` を付与している。GitHub Pages/Safari側のキャッシュにより、ファイルを更新してもクライアントに反映されない問題が実際に発生したため、**該当ファイルを変更するコミットでは必ずクエリのNをインクリメントする**運用を徹底する（`index.html` 内のコメントに明記）。参照コミット時点: `style.css?v=6`, `announcements.js?v=1`, `roadmap.js?v=1`, `data.js?v=2`, `game.js?v=9`。設計書のみの更新ではこれらの番号を変更しない。

## 6. 採用済み拡張のデータ・処理設計（§6.4〜6.6は実装済み、他は未実装）

ここからのフィールド・関数・キーは実装予定の設計名である。現行に存在する関数とは区別する。値・IDはスキーマ説明用の例であり、個別コンテンツの確定性能や公開日程を意味しない。

### 6.1 キャラ・ジョブ別進行の追加フィールド（未実装）
```js
jobLevels[jobId] = {
  level, exp, expToNext,             // 現行値を保持
  skillTree: {
    treeId: null,                    // 適用中ツリー
    spEarned: 0,
    nodeRanks: {},                    // { [nodeId]: rank }
    sourceRarity: null                // 標準ツリーはnull、ブック由来はn/r/sr/ur/lr
  },
  mastery: { unlocked: false, level: 0 }
};
```
- SP残量は「獲得SP＋公開済み・有効な適性補正－有効ノードの消費SP」で算出し、保存した残量との二重管理を避ける
- 初期の獲得SP量・過去レベルへの補填方式・極みのlevel用途は調整事項。未公開状態で既定値を追加しても効果は発生しない
- 現行の `gainExp()`、`newCharacter()`、転職の書き戻しでは `jobLevels[jobId]` を `{ level, exp, expToNext }` で置換している。新規フィールドを失わないよう、既存レコードを保持してレベル部分だけ更新する
- 転職で対象ジョブのツリーと極み進行を復元する。現在使用中ジョブ以外のツリー／極み効果は戦闘へ持ち込まない
- ツリー交換時のSP返還・取得ノードのリセット／保持は未確定。実装前に決定して確認画面へ明示し、異なるツリーのnodeIdをそのまま引き継がない
- ノード振り直しと別ツリーへの交換は別操作。元のブック由来ツリーへ交換して戻すときも1冊を必要とする

### 6.2 ツリー・ブック・極みマスター（未実装）
```js
// ツリー定義の構造例
{
  id: "berserker_sr",
  name: "狂戦士",
  rarity: "sr",
  allowedTags: ["warrior", "dark"],
  allowedJobIds: null,              // null=タグのみ。配列ならタグとジョブの両方を満たす
  nodes: [
    {
      id: "node_1",
      kind: "passive",              // active / passive
      maxRank: 1,
      costByRank: [1],
      prerequisites: [],            // { nodeId, minRank } の配列
      exclusiveGroup: null,
      effects: []                    // 種別・条件・重複ルール・上限を定義
    }
  ]
}
// ブックマスターの構造例
{ id: "book_berserker_sr", treeId: "berserker_sr", rarity: "sr" }
// 鑑定費用はレア度別設定。20/50/120/300/800は調整案
// 極みマスターの構造例
{ jobId: "warrior", requiredLevel: 99, effects: [] }
```
- `canUseTree(c, tree)`: プレイヤーキャラ、関連機能が公開済み、現ジョブのタグが許可タグに一致、ジョブ制限があればそれも一致、必要マスターが有効であることを検証
- モンスターへのブック適用は初期の対象に含めない。専用ツリーを採用する場合に別途要件化する
- `canAcquireNode(c, node)`: 対象チーム未ロック、ランク上限、前提ランク、排他群、SP残量を検証する。UIの無効表示だけに頼らず確定処理でも再判定する
- 効果は `statModifier`、`abilityUnlock`、`conditionalModifier` 等の種別で解決する。未対応の効果種別を持つマスターは公開しない
- 条件付き効果は例えば `hpRatio <= threshold` として評価し、条件が外れたら解除する。効果ごとに加算／乗算・上限を定義する
- LRの低HP型で例示した攻撃+60%・速度+25%・被ダメ+30%・回復-50%などは未確定。具体的な数値を既存ダメージ計算へ直接固定しない

### 6.3 スキルブック個体・鑑定・使用（未実装）
```js
// セーブ内の共有配列skillBooksの要素
{
  id: "book_instance_unique",         // 所持品内で一意
  rarity: "sr",
  bookDefinitionId: "book_berserker_sr", // ドロップ抽選時に確定し保存
  identified: false
}
```
未鑑定では `bookDefinitionId` の名称・効果・適性をUIに露出しない。内部保存値まで秘密であることは保証しない。同じ個体を鑑定するたびに内容が変わらないよう、確定した対応マスターIDを保存する。初期実装にランダムな追加性能ロールは含めない。

| 設計上の処理 | 検証・状態変化 |
| --- | --- |
| `rollSkillBookDrop()` | 公開ゲートを確認。ブック専用確率で個体生成。装備の出現率を流用しない |
| `settleSkillBookDrops(run)` | 踏破でskillBooksへ、全滅なら破棄。ID衝突を防ぐ |
| `identifySkillBook(id)` | 未鑑定個体・マスター・費用・残高を再確認。強化石減算＋identified=trueを同時確定 |
| `useSkillBook(id, characterId)` | 鑑定済み、適性、機能ゲート、対象チーム未ロックを再確認。ツリー更新＋個体1冊削除を同時確定 |
| `unlockJobMastery(characterId, jobId)` | 対象基本職を使用中、Lv99以上、未解放、機能ゲート、対象チーム未ロックを確認 |

本の使用は確認後に確定し、取り消し・不足・適性外・探索ロック・保存失敗では本や強化石を消費しない。適用中と同じツリーへの不要な再使用は無効にする。確認中の連打を防ぎ、確定直前にも個体の存在と残高を検証する。

ブック個体は装備の `pendingDrops` と区別できる `pendingSkillBooks` に保留し、出撃時の機能公開スナップショットに従う。オフライン踏破でも同じ抽選と確定処理を利用する。機能導入前の保存区間に遡って新しいブックを付与しないため、離脱時点の有効機能を保存し、旧セーブは新機能無効として精算する。

### 6.4 冒険者ギルドからのお知らせ・既読・起動時選択（実装済み）
```js
// 配布するannouncements.jsonの構造例
{
  id: "job_mastery_teaser",            // 告知の安定ID
  revision: 1,                        // 本文の重要な改訂時に増加
  publishedAt: "<ISO 8601日時・タイムゾーン付き>",
  expiresAt: null,
  category: "preview",               // notice / update / balance / preview
  title: "極めし者に、新たな道が開かれる。",
  body: ["近日、新たな育成要素を追加予定です。", "詳細は後日公開します。"],
  showOnStartup: true,
  priority: "normal",                // normal / important
  forceDisplay: false,               // importantにのみ許可。既読でも起動時候補になる
  visible: true
}
```
- `jobquest_read_announcements` に `{ "<id>": <既読revision> }` を保存する。既読判定は `readRevision >= announcement.revision`
- 初期のID配列案から移行する場合は、そのIDの初版revision=1を既読とする。新しいrevisionを誤って既読にしない
- `visible`、公開日時、公開終了日時で候補を絞る。日時にはオフセットを必須とし、UIの日付表示はAsia/Tokyoを使用する
- 通常の起動候補は `showOnStartup && 未読` の最新1件。重要・強制再表示の候補がある場合はそれを優先し、同優先度内は公開日時降順、同日時ならIDで安定ソートする
- `priority: important` だけでは毎回表示しない。`forceDisplay` を明示した公開中の重要告知だけ、既読でも新規起動時に再表示する。運営は必要期間だけ指定する
- 1起動で自動表示する告知は最大1件。`startupAnnouncementHandled` を一時状態として保持し、閉じた直後に次の未読を連続表示しない
- 詳細を正常に描画したときだけ既読revisionを保存し、タイトルの未読バッジを更新する。一覧だけの閲覧では変更しない
- 既読保存が失敗した場合はセッション内のみ既読扱いにし、次回起動では再表示され得る。告知の不具合でゲーム本体のセーブを初期化しない
- 本文はテキストとして描画する。告知文字列を無検証の `innerHTML` として挿入しない

`loadAnnouncements()` は同一オリジンの静的ファイルを取得・検証し、失敗時は空配列または検証済みのキャッシュへフォールバックする。取得タイムアウトを設け、失敗・不正データ・未読ゼロで自動モーダルを開かない。告知取得の失敗はプレイの阻害要因にしない。

### 6.5 予定表・情報公開の段階（実装済み）
```js
// roadmap.jsonの構造例。現時点で公表できる情報だけを配布
{
  id: "job_mastery",
  status: "planned",                 // released / development / planned
  timingLabel: "公開時期未定",         // 確定後に月・日付表示へ更新
  disclosureStage: "teaser",         // teaser / named / conditions / released
  title: "？？？",
  summary: "極めし者に、新たな道が開かれる。"
}
```
- 名称解禁時にtitle・対象を追加し、条件解禁時にLv99以上の条件と検証済みの一部能力を追加する
- 未解禁の対象・条件・性能を同じ配布ファイルに格納してCSSで隠す方式にはしない
- 重要な情報追加は関連告知のrevision更新または新規告知IDで知らせる。古い予告を一覧で残す場合は、その内容が予告時点のものと分かるようにする
- `released` は機能本体が公開され利用可能なときだけ設定する。コード完成・非公開の状態は開発中と表示する
- 告知本文の更新とゲーム機能の公開ゲートは独立して扱い、予告の公開で機能が解放されないようにする
- サーバー管理機能なしの初期運用ではファイル編集・デプロイで段階を切り替える。端末時計による無人の機能公開は行わない
- 静的JSON・JSを変更する際はキャッシュ更新用バージョンを更新する。アプリを開いたままの全端末へ即時反映できる運用とは扱わない

### 6.6 起動順序・モーダル排他（実装済み）
1. 公開済みプレイ用マスターを検証し、新フィールドを補完してセーブを復元する
2. 離脱時の有効機能に従ってオフライン進行を精算し、結果を保存する
3. タイトルを描画する。告知取得は並行でき、プレイ開始を無期限に待たせない
4. 告知取得終了／タイムアウト後、起動時お知らせを最大1件キューへ積む
5. オフライン結果があれば同じキューの次へ積む
6. 他のモーダルがないときだけ先頭を開き、閉じたら次を開く

キューは詳細表示中のモーダルに割り込まない。起動時の取得待ち中に「はじめる」を押した場合も現在画面を維持する。一覧から詳細を開くときも共通のモーダル排他を利用する。告知表示で戦闘状態を初期化したり、オフライン報酬を再精算したりしない。

## 7. 保存・機能ゲートの拡張設計（実装済み）

### 7.1 スキーマ移行（実装済み）
```js
// jobquest_save_v1に追加するフィールド
{
  schemaVersion: 2,
  roster, inventory, activeTeam, clearedDungeons, nextCharSeq,
  savedAt, autoRepeat,              // 現行フィールドを保持
  skillBooks: [],
  material: 0,                     // 拡張移行後の正本
  enabledFeaturesAtSave: []         // 離脱時の有効機能。オフライン精算に利用
}
```
- schemaVersion未設定は旧形式。既存強化石キーからmaterialを移行し、配列・ジョブ別新フィールドを欠落時のみ補完する
- 現行の強化石は別キーであり複数キー間にトランザクションがない。鑑定公開時は強化石とブックを同じメインセーブのスナップショットに含め、両方の更新を1回の保存で確定する
- 移行後はメインセーブのmaterialを正本とし、旧 `jobquest_material` は互換用のミラーとして更新する。メイン値があるとき旧値で上書きしない。装備強化・分解・報酬も同じ正本を使う
- 確定操作は更新後スナップショットを作り、保存に成功してから画面へ反映する。保存失敗時は更新前状態を維持し成功表示を出さない
- 未公開機能の保存値や未知の拡張フィールドは保持し、ゲートで作用を止める。対応しないデータを理由に全セーブを初期化しない
- 先行基盤リリースで移行したセーブを、拡張を保持できない旧アプリ版で上書きしないよう、バージョン互換を検証する

### 7.2 公開フラグと依存関係（実装済み。ただしskillTree以降を有効化した際の依存関係チェック自体は未実装）
| 機能キー（設計名） | 依存 | 無効時の制御 |
| --- | --- | --- |
| announcements | なし | 新しい告知入口・起動表示を出さない |
| skillTree | マスター・保存互換・戦闘／AI統合 | SP取得・ノード操作・ツリー効果を適用しない |
| skillBook | skillTree | ドロップ・ブック使用を無効化 |
| appraisal | skillBook | 鑑定を無効化 |
| jobMastery | skillTree＋skillBook＋appraisal | 解放・補正を無効化 |

フラグは配布バージョンの運営設定であり、告知の公開日時・端末時計から算出しない。表示だけでなく、呼び出し先の確定処理・報酬・戦闘・オフライン精算でも確認する。依存を満たさない設定は安全側へ無効化する。

極み条件は `!c.isMonster && JOBS[jobId].tier === "basic" && level >= 99` を使用する。現ジョブの最新レベルをジョブ別記録へ同期してから判定し、保存記録の更新遅れを避ける。上級職解放の `JOB_MASTER_LEVEL=50` はそのまま利用し、極みの定数と兼用しない。極みは対象基本職を使用中のみ有効、他職のサブアビリティに極み補正を持ち越さない。

## 8. 実装・公開前の確認項目

この更新は設計書のみであり、以下は機能実装時の受け入れ条件である。実行済みテストとは扱わない。

| 領域 | 確認内容 |
| --- | --- |
| 告知 | 未読最新1件、通常既読の再表示なし、改訂時未読、重要再表示、1起動1件、📢バッジ、一覧から再読、設定導線 |
| 告知例外 | 未来／期限切れ／不正データ／取得失敗、既読保存失敗、オフライン結果との排他、タイトル再描画・背景復帰 |
| 予告 | 各公開段階で許可した情報のみ配布、予定未定の扱い、日付経過だけで機能未解放 |
| 本 | 未鑑定のレア度のみ表示、鑑定後ストック、費用不足・連打・保存失敗、使用で1冊消費、元へ戻す場合も1冊 |
| 適性・ロック | 系統一致と個別制限、モンスター対象外、対象チームだけロック、鑑定でキャラ状態が変わらない |
| SP・戦闘 | ノード前提・排他・上限・SP不足、AI設定、取得済みだけ有効、重複倍率・条件効果解除 |
| 極み | 基本6職、Lv98不可／Lv99以上可、既存のLv100以上可、Lv50との独立、転職保持、基本職使用中のみ補正 |
| ドロップ | 踏破確定／全滅破棄、装備自動分解と分離、通常・オフライン同一定義、導入前期間への新報酬なし |
| 保存互換 | 旧セーブ復元、転職／EXP更新で拡張値保持、material移行・原子的保存、未公開値保持 |
| 機能ゲート | 未公開のUI・処理・ドロップ・効果・オフライン報酬すべて無効、依存不成立も無効 |
| 既存挙動 | 4チーム並行探索、装備強化、自動分解、転職、テイム、自動周回への回帰なし |

個別ツリー・極みの数値、SP制度、交換時の進行の扱い、適性一覧、鑑定費用、出現率、公開日程は要件定義書§6の確定待ち項目と同期して決める。
