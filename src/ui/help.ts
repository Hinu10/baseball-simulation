// 操作説明。
export const HELP_HTML = `
<h2>操作説明</h2>
<div class="help-grid">
  <section><h3>投球（守備のとき）</h3>
    <p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> コースを動かす</p>
    <p><kbd>Q</kbd><kbd>E</kbd> プレートを踏む位置を左右に動かす</p>
    <p><kbd>L</kbd> 球種を切り替える（狙ったコースへの軌道が線で出ます）</p>
    <p><kbd>J</kbd> 投げる</p></section>
  <section><h3>打撃（攻撃のとき）</h3>
    <p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ミートカーソルを動かす</p>
    <p><kbd>J</kbd> スイング（球が本塁に来る瞬間に）</p>
    <p><kbd>L</kbd> ミート ⇔ 強振（強振はカーソルが小さく、当たれば遠くへ飛ぶ）</p>
    <p><kbd>K</kbd> バントの構え</p>
    <p><kbd>Q</kbd><kbd>E</kbd> 打席の立ち位置を左右に動かす（投球前）</p>
    <p><kbd>R</kbd> 盗塁（投球前に押すと投球動作と同時にスタート。投球動作中に押すとスタートが遅れる。打てばエンドラン）</p>
    <p class="note">球がバットの芯（緑の帯）に当たるほど遠くへ飛びます。根っこだと詰まり、先っぽだと弱い打球になります。内角を打つなら離れて、外角なら寄って立つと芯に当たりやすい。</p>
    <p class="note">カーソルの中心より球が上ならフライ、下ならゴロになりやすい。早く振ると引っ張り、遅れると流し打ち。</p>
    <p class="note"><b>打撃：かんたん</b>（メニュー・ポーズで切り替え）：カーソルは自動で球に合うので、<kbd>J</kbd> のタイミングだけ合わせればOK。<kbd>W</kbd>＋<kbd>J</kbd> でフライ、<kbd>S</kbd>＋<kbd>J</kbd> でゴロを狙えます。ゾーンから大きく外れた球には届きません。</p></section>
  <section><h3>守備（打球が飛んだら）</h3>
    <p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 黄色い輪の選手を動かす（赤い印が落下点）</p>
    <p><kbd>J</kbd>＋<kbd>W</kbd> 二塁 ／ <kbd>J</kbd>＋<kbd>D</kbd> 一塁 ／ <kbd>J</kbd>＋<kbd>A</kbd> 三塁 ／ <kbd>J</kbd>＋<kbd>S</kbd> 本塁 へ送球（<kbd>J</kbd> だけでおすすめの塁）</p>
    <p><kbd>K</kbd> ダイビング　<kbd>L</kbd> ボールに近い選手に切り替え</p>
    <p class="note">3秒操作しないと CPU が代わりに動きます。メニューやポーズで「守備：オート」にすると、守備はずっと CPU に任せられます。</p></section>
  <section><h3>走塁（打ったあと）</h3>
    <p><kbd>J</kbd> 進塁　<kbd>K</kbd> 帰塁　<kbd>L</kbd> 指示する走者を切り替え（全員 → 1人ずつ）</p>
    <p class="note">指示しない走者は CPU が判断して走ります。</p></section>
  <section><h3>試合中</h3>
    <p><kbd>Tab</kbd> モード切替（手動 → 監督 → 自動。次の投球から）</p>
    <p><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 監督モードの方針（攻撃・投球・走塁）</p>
    <p><kbd>F</kbd> 自動モードの早送り（×1・×2・×4）</p>
    <p><kbd>Esc</kbd> ポーズ（選手・打順、選手交代もここから）</p></section>
  <section><h3>モード</h3>
    <p><b>手動</b>：投げる・打つ・守る・走るを自分で操作（守備だけ CPU に任せる「守備：オート」も選べます）</p>
    <p><b>監督</b>：選手は CPU が操作し、あなたは方針を指示</p>
    <p><b>自動</b>：CPU 同士の試合を観戦（早送り・試合終了までスキップ可）</p></section>
</div>
<p class="note">ゲームパッド：A＝J、B＝K、X＝L、LB/RB＝Q/E、Y＝盗塁、スタート＝ポーズ</p>
`;
