import { Brand, Icon, ThemeToggle } from './ui'
import { PLANS, naira } from './plans'

const PAIRS = ['EURUSD', 'USDCHF', 'USDCAD', 'USDJPY', 'AUDUSD', 'XAUUSD']
export default function Landing({ onAuth }: { onAuth: (m: 'in' | 'up') => void }) {
  return (
    <main className="w">
      <div className="nav"><Brand /><div className="cta"><ThemeToggle /><button className="btn sm" onClick={() => onAuth('in')}>Sign in</button><button className="btn sm p" onClick={() => onAuth('up')}>Get access</button></div></div>
      <section className="hero">
        <div>
          <h1>Trade pullbacks that agree with the trend.</h1>
          <p className="lead">FX Desk watches EURUSD, USDJPY, gold and three more pairs all day, Monday to Friday, and sends you the timeframe, entry, stop loss and targets.</p>
          <div className="cta"><button className="btn p" onClick={() => onAuth('up')}>Start with signals</button><a className="btn" href="#how">See how it works</a></div>
        </div>
        <div className="card"><h3>Example signals <span className="tg">sample</span></h3>
          <div className="sig"><span className="tag b">Buy</span><b>EURUSD<span className="tg">M5</span></b><span className="mu">4m ago</span><div className="nums"><span>Entry <b>1.08420</b></span><span>SL <b>1.08301</b></span><span>TP1 <b>1.08599</b></span><span>TP2 <b>1.08777</b></span></div><div className="mu" style={{ gridColumn: '1 / -1' }}>Trend pullback · H1 trend · valid for 11m · hold up to 4h</div></div>
          <div className="sig"><span className="tag s">Sell</span><b>XAUUSD<span className="tg">M15</span></b><span className="mu">22m ago</span><div className="nums"><span>Entry <b>3912.40</b></span><span>SL <b>3921.90</b></span><span>TP1 <b>3898.15</b></span><span>TP2 <b>3883.90</b></span></div><div className="mu" style={{ gridColumn: '1 / -1' }}>Structure retest · H4 trend · hold up to 8h</div></div>
        </div>
      </section>
      <section className="sec" id="how"><h2>How a signal is made</h2><div className="g3">
        <div className="card"><div className="row" style={{ justifyContent: 'flex-start', gap: 10, marginBottom: 12 }}><span className="tile"><Icon n="bars" /></span><span className="step" style={{ margin: 0 }}>Step 1</span></div><h3>Read the market</h3><span className="mu">The bot reads the 5-minute, 15-minute and 1-hour charts on every candle close, plus the bigger trend above each one.</span></div>
        <div className="card"><div className="row" style={{ justifyContent: 'flex-start', gap: 10, marginBottom: 12 }}><span className="tile"><Icon n="logo" /></span><span className="step" style={{ margin: 0 }}>Step 2</span></div><h3>Find a setup</h3><span className="mu">It looks for a pullback inside a confirmed trend, and for a break of market structure that gets retested.</span></div>
        <div className="card"><div className="row" style={{ justifyContent: 'flex-start', gap: 10, marginBottom: 12 }}><span className="tile"><Icon n="bot" /></span><span className="step" style={{ margin: 0 }}>Step 3</span></div><h3>Test before it sends</h3><span className="mu">Every day it backtests each strategy on each pair and timeframe, and only sends signals from combinations that passed.</span></div></div></section>
      <section className="sec"><h2>Pairs we scan</h2><div className="chips">{PAIRS.map((p) => <span className="chip" key={p}>{p}</span>)}</div>
        <p className="mu">The scanner works every candle close, Monday to Friday, on M5, M15 and H1.</p></section>
      <section className="sec"><h2>Plans</h2><div className="g3">
        <div className="card"><h3>{PLANS.signals.name}</h3><div className="price">{naira(PLANS.signals.price)}<small> / month</small></div>
          <ul><li>Live signals on the site</li><li>Timeframe, entry, stop and two targets</li><li>Every signal's result tracked</li></ul><button className="btn p" onClick={() => onAuth('up')}>Get access</button></div>
        <div className="card feat"><h3>{PLANS.auto.name}</h3><div className="price">{naira(PLANS.auto.price)}<small> / month</small></div>
          <ul><li>Everything in Signals</li><li>Auto-trading on your own account</li><li>Connect it with your Deriv API key</li><li>Loss limits and a kill switch</li></ul><button className="btn brown" onClick={() => onAuth('up')}>Get access</button></div></div></section>
      <div className="foot">Trading carries risk and you can lose money. Signals are not financial advice, and past results do not guarantee future ones.</div>
    </main>
  )
}
