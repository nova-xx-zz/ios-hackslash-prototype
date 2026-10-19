# ダンジョン35種類の階層割当・序盤3F/5F試作

> 2026-10-16 / ステータス: **仮割当・隔離試作、既存の通常プレイは未変更**。
> 元データ: `js/data.js` の DUNGEONS 35件。試作構成: `js/core/dungeon-trial.js`。試作テスト: `tests/dungeon-trial.test.js`。

## 基本方針

- 3F→5F→10F→15Fへ段階的に拡張。最初は**3F（はじまりの草原／ささやきの森）と5F（こだまの洞窟）**の試作・体感を優先する。
- 10Fは5Fに中ボス、10Fに最終ボス。15Fは5F/10Fに中ボス、15Fに最終ボス。
- 既存の各ダンジョンの**最終ボスIDを再利用**する。中ボスは当面そのダンジョンの通常敵poolから候補を選ぶ**仮ID**であり、世界観・強さ・属性の個別レビュー後に確定する。
- 1F～2Fは通常1～3戦、3F～5Fは2～4戦、6F～10Fは3～5戦、11F～15Fは3～6戦。突入時に全階層の通常戦闘数を確定。
- 1戦闘の敵数は1～5体（ボス・取り巻き込み）。レアモンスターは既存pool/raresベース、具体的な調整は保留。
- **中ボス撃破でも報酬は持ち帰れない**。最終ボスで完全踏破したときのみ確定。失敗・撤退・時間切れ時はUR/LR含め、その周回の未確定アイテムは全ロスト。
- イベント処理は非ブロッキング。泉は水を自動で飲むのではなく魔力・霧の影響としてバフ/デバフ。盗賊の鍵付き宝箱解錠はスキル習得時のみ確率判定。

## 35ダンジョン別の暫定割当

| 地方 | ダンジョン（ID） | 階層 | 中ボス候補（5F/10F） | 最終ボスID |
|---|---|---:|---|---|
| ヴェルデ | はじまりの草原 (`plains`) | 3 | なし | `horned_rabbit` |
| ヴェルデ | ささやきの森 (`forest`) | 3 | なし | `elder_treant` |
| ヴェルデ | こだまの洞窟 (`cave`) | 5 | なし | `rock_golem` |
| ヴェルデ | 忘れられた遺跡 (`ruins`) | 5 | なし | `stone_gargoyle` |
| ヴェルデ | 竜骨の山頂 (`peak`) | 5 | なし | `ancient_wyvern` |
| サブル | 蜃気楼の砂丘 (`dunes`) | 5 | なし | `king_worm` |
| サブル | サソリの谷 (`canyon`) | 5 | なし | `emperor_scorpion` |
| サブル | 枯れたオアシス (`oasis`) | 5 | なし | `cursed_naga` |
| サブル | 砂に沈んだ王墓 (`tomb`) | 10 | 5F: `sand_bandit` | `mummy_king` |
| サブル | 灼熱の大神殿 (`sun_temple`) | 10 | 5F: `mirage_spirit` | `sphinx` |
| グラシア | 白霜の樹海 (`frost_forest`) | 10 | 5F: `frost_wolf` | `frost_treant` |
| グラシア | 凍てつく湖 (`frozen_lake`) | 10 | 5F: `snow_owl` | `frozen_kraken` |
| グラシア | 氷晶の洞窟 (`crystal_cave`) | 10 | 5F: `ice_wisp` | `crystal_queen` |
| グラシア | 雪原の砦跡 (`snow_fort`) | 10 | 5F: `crystal_golem` | `frozen_general` |
| グラシア | 氷竜の玉座 (`ice_throne`) | 10 | 5F: `ice_serpent` | `frost_dragon` |
| イグニス | 灰降る平原 (`ash_plains`) | 10 | 5F: `salamander_knight` | `ash_behemoth` |
| イグニス | 溶岩の大河 (`lava_river`) | 10 | 5F: `obsidian_golem` | `magma_leviathan` |
| イグニス | 炎の鍛冶場跡 (`forge_ruins`) | 10 | 5F: `fire_giant` | `forge_master` |
| イグニス | 大火口 (`crater`) | 10 | 5F: `ash_wolf` | `ifrit` |
| イグニス | 業火の霊峰 (`inferno_peak`) | 10 | 5F: `obsidian_golem` | `inferno_dragon` |
| マリナ | 珊瑚の浅瀬 (`coral_reef`) | 10 | 5F: `fire_serpent` | `reef_hydra` |
| マリナ | 幽霊船 (`ghost_ship`) | 10 | 5F: `merfolk_soldier` | `phantom_captain` |
| マリナ | 潮騒の海洞 (`sea_cave`) | 10 | 5F: `drowned_sailor` | `sea_serpent_king` |
| マリナ | 沈んだ古代都市 (`sunken_city`) | 15 | 5F: `kraken_spawn` / 10F: `ghost_pirate` | `drowned_king` |
| マリナ | 大海溝 (`leviathan_trench`) | 15 | 5F: `reef_shark` / 10F: `coral_golem` | `leviathan` |
| セレスタ | 雲上の道 (`cloud_road`) | 15 | 5F: `siren` / 10F: `griffon` | `storm_roc` |
| セレスタ | 浮遊島 (`floating_isle`) | 15 | 5F: `cloud_golem` / 10F: `star_beast` | `isle_guardian` |
| セレスタ | 天空庭園 (`sky_garden`) | 15 | 5F: `sky_knight` / 10F: `sky_wisp` | `garden_warden` |
| セレスタ | 雷鳴の尖塔 (`thunder_spire`) | 15 | 5F: `griffon` / 10F: `seraph_guard` | `thunder_god_beast` |
| セレスタ | 天空宮殿 (`celestial_palace`) | 15 | 5F: `archon` / 10F: `sky_knight` | `sky_emperor` |
| アビス | 深淵の門 (`abyss_gate`) | 15 | 5F: `nether_hound` / 10F: `chaos_imp` | `gate_keeper` |
| アビス | 影の迷宮 (`shadow_labyrinth`) | 15 | 5F: `bone_colossus` / 10F: `abyss_knight` | `labyrinth_lord` |
| アビス | 虚無の海 (`abyss_sea`) | 15 | 5F: `abyss_mage` / 10F: `nightmare` | `void_kraken` |
| アビス | 堕ちた城塞 (`fallen_citadel`) | 15 | 5F: `abyss_leech` / 10F: `chaos_imp` | `fallen_king` |
| アビス | 深淵の心臓 (`abyss_heart`) | 15 | 5F: `abyss_knight` / 10F: `nether_hound` | `abyss_lord` |

> 中ボスは仮の通常敵を戦闘上のボス属性に昇格させる案。**このテーブルを公開確定データとはしない。** 特に10F/15Fの候補は今後プレイしてから変更してよい。

## 先行3F/5Fボスの試作

| ダンジョン | 階層 | ボス | フェーズ・演出 | 今回の状態 |
|---|---:|---|---|---|
| はじまりの草原 | 3F | ツノウサギ | 1フェーズ、通常攻撃中心 | 出現計画のみ試作 |
| ささやきの森 | 3F | エルダートレント | 1フェーズ、既存特性を優先 | 出現計画のみ試作 |
| こだまの洞窟 | 5F | ロックゴーレム | HP60%以下で防御倍率1.25、予兆ログ | フェーズデータのみ試作 |

**フェーズの実際の戦闘適用、演出表示、セーブ復旧、オフライン周回との共有処理は未実装。**
最初にゲーム本体へ導入するときは、機能ゲート付きで稼働させ、実装後に戦闘/画面/オフラインの受入テストを全て通す。

## 周回規模の見積もり

| 階層 | 通常戦闘の最少～最多 | 平均 | ボス戦 |
|---|---|---:|---:|
| 3F | 4～10 | 7 | 1 |
| 5F | 8～18 | 13 | 1 |
| 10F | 23～43 | 33 | 2 |
| 15F | 38～73 | 55.5 | 3 |

上の戦闘時間は固定ではない。装備、敵数、フェーズ、難易度モードで実測し、クリア時のレア装備期待値・素材時給とあわせて再調整する。**失敗時の全ロストは調整によって撤回しない**。

## 段階的な本体統合ゲート

1. [現在] 隔離モジュールで階層/ボス/1～5体/全ロストの決定的なUTを作成しCIで確認。
2. 本体`run.js`の戦闘番号・階層・ボス判定を共通アダプタ化。古い`dungeon.battles`参照を全検索。最初は`plains`、`forest`、`cave`のみ機能ゲートで有効にする。
3. 3Fボスの単純な戦闘→5FロックゴーレムのHP60%フェーズを、画面・通常自動・オフラインで共有実装。
4. 敗北・途中撤退・タイムアウト・クラッシュ/復旧・4チーム周回・旧セーブ互換・報酬原子的確定をIT。
5. 実データの踏破率・平均戦闘時間・装備収支の比較（通常/ハード/エクストラ）。旧3～5戦モデルの数値を流用しない。
6. iPhone Safari/Chromeで手動確認。**本体統合できても実機テスト未済なら配信しない**。その後10/15Fを解放。

## 試作の制約

- `js/core/dungeon-trial.js`は純粋な計画生成/フェーズ候補/結果集計のみ。本体の`buildEncounter`や`winBattle`には接続していない。ゲームの見た目やリリース版の動作は変わらない。
- 試作コードでの`resolveTrialDrops`は**純粋な計算例**であり、実際の所持品・報酬の確定処理ではない。実装には`runId`・未確定品・原子的永続化・二重付与防止が別途必要。
- オフライン精算が大量の戦闘を扱う場合、1周の目安時間/8時間精算上限や再抽選順序にも注意する。
