# 詳細設計書

対象コード: `js/data.js`, `js/game.js`（2026-09時点、コミット `4adc827` 相当）

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

### 1.3 ダンジョン進行オブジェクト `run`

`startDungeon(id)` で生成、`screen-battle` を離れても `finishRun()` まで保持される一時状態。

```js
{
  dungeon,               // DUNGEONS の要素
  battleIndex,            // 0-origin。最後の要素がボス戦
  finished, wiped,
  buffs: { atk, mag, def, spd },   // 石碑イベントで加算される割合バフ（このダンジョン中のみ）
  expTotal, levelUps, abilityUnlocks, defeatedTamable,
  drops,                  // 確定済みドロップ（踏破時のみpendingDropsから移される）
  pendingDrops,            // 踏破するまで確定しない保留ドロップ
  disassembleCount, materialGained,
}
```

### 1.4 セーブデータスキーマ（`localStorage["jobquest_save_v1"]`）

```js
{
  roster,                // キャラクターオブジェクトの配列をそのままJSON化
  inventory,
  activeTeam,
  clearedDungeons: [...clearedDungeons], // Setを配列化
  nextCharSeq,
  savedAt: Date.now(),
  autoRepeat: {
    active: autoRepeatActive,
    target: autoRepeatTarget,
    done: autoRepeatDone,
    dungeonId: run && run.dungeon ? run.dungeon.id : null,
  },
}
```

`run`/`battle` そのもの（進行中の戦闘状態）は保存しない。ロード後は `autoRepeat.dungeonId` を使ってオフライン進行の計算のみ行い、実際の戦闘再現はしない。

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

### 2.5 ATB戦闘ループ

定数: `ATB_RATE = 7`

```
loop(t):  dt = min(0.05, (t - lastT)/1000) * speedMult
tick(dt):
  for each alive party member c:
    c.atb += computeStats(c).spd * ATB_RATE * dt
    if c.atb >= 100: performCharacterAction(c); checkBattleEnd()
  for each alive enemy e:
    e.atb += e.spd * ATB_RATE * dt
    if e.atb >= 100: performEnemyAction(e); checkBattleEnd()
```
`speedMult` は `btnSpeedToggle` で 1 または 2 を切り替える。`requestAnimationFrame` により毎フレーム呼び出される。

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

`runOfflineProgress(autoRepeatInfo, savedAt)`:
1. `elapsedMs = min(now - savedAt, OFFLINE_MAX_MS)`。5秒未満なら計算しない（何もしなかったとみなす）
2. `maxRunsByTime = floor(elapsedMs/1000 / estimateOfflineRunSeconds(dungeon))`
3. `runsToAttempt = min(maxRunsByTime, target - done)`
4. `runsToAttempt` 回、`simulateOfflineRun(dungeon)` を実行。全滅（`cleared:false`）が出た時点でループを打ち切り、それ以前の成功分のみ結果に反映する

`simulateOfflineRun(dungeon)` は `offlineClearChance` で踏破/全滅を1回抽選し、踏破時のみ全戦闘分のEXP・ドロップ（1戦闘あたり基本1個＋40%で追加1個、`rollItemDrop()`）・テイム抽選（該当種のいずれか1体、`tameChance`で判定）を通常プレイと同じ処理で反映する。全滅時は何も反映せずその周を打ち切る（オフライン中も「全滅時は持ち帰れない」仕様を維持）。

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
| モンスター図鑑 | `renderDexScreen()`, `openDexDetail(key)` |
| パーティ編成 | `renderJobsScreen()`, `buildPartyRow()`, `buildMemberCard()`, `attachMemberDrag()`（ドラッグ移動） |
| キャラ作成 | `renderCreateScreen()`, `renderPickModal()`, `confirmCreate()` |
| キャラ詳細: 能力値 | `buildStatsTab()` |
| キャラ詳細: 装備 | `buildEquipSection()`, `autoEquip()`, `openEnhanceModal()` |
| キャラ詳細: スキル | `buildSkillTab()`, `buildSkillRow()`, `cycleAbilityTier()` |
| キャラ詳細: ジョブ/合成 | `buildJobTab()` → 人間は `buildJobCard()` 一覧、モンスターは `buildFusionTab()` |
| マップ | `renderMap()`, `selectDungeon()`, `renderDungeonInfo()` |
| 探索ドック | `renderDock()`, `renderAutoRepeatRow()`, `renderDisassembleFilter()` |
| 戦闘進行 | `startDungeon()`, `startBattle()`, `loop()`/`tick()`, `onVictory()`, `onDefeat()`, `finishRun()` |
| セーブ/ロード | `saveGame()`, `scheduleSave()`, `loadGame()` |
| オフライン進行 | `runOfflineProgress()`, `simulateOfflineRun()`, `showOfflineModal()` |

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

`index.html` の `css/style.css`・`js/data.js`・`js/game.js` の読み込みには `?v=N` を付与している。GitHub Pages/Safari側のキャッシュにより、ファイルを更新してもクライアントに反映されない問題が実際に発生したため、**該当ファイルを変更するコミットでは必ずクエリのNをインクリメントする**運用を徹底する（`index.html` 内のコメントに明記）。2026-09時点: `style.css?v=2`, `data.js?v=1`, `game.js?v=5`。
