import { Brand } from './ui'

export default function SetupNeeded({ hasUrl, hasKey }: { hasUrl: boolean; hasKey: boolean }) {
  return (
    <main className="login" style={{ maxWidth: 520 }}>
      <Brand />
      <h2 style={{ margin: 0 }}>Almost there: the site needs two settings</h2>
      <p className="mu">The website is online, but it does not know where your database is yet. Add these two in Vercel, then redeploy.</p>
      <div className="card">
        <div className="row"><b>VITE_SUPABASE_URL</b><span className={hasUrl ? 'ok' : 'neg'}>{hasUrl ? 'found' : 'missing'}</span></div>
        <div className="row" style={{ marginTop: 8 }}><b>VITE_SUPABASE_ANON_KEY</b><span className={hasKey ? 'ok' : 'neg'}>{hasKey ? 'found' : 'missing'}</span></div>
      </div>
      <ol className="mu">
        <li>Supabase: Project Settings, then API. Copy the Project URL and the anon public key.</li>
        <li>Vercel: your project, Settings, Environment Variables. Add both names above with those values.</li>
        <li>Vercel: Deployments, open the latest one, press Redeploy. The settings only take effect after a redeploy.</li>
      </ol>
    </main>
  )
}
