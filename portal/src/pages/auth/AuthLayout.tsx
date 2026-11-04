import type { ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'

export default function AuthLayout({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="relative hidden flex-col justify-between bg-brand-black p-10 text-white lg:flex">
        <a href="/" className="flex items-center gap-3"><img src="/img/logo.png" alt="" className="h-12 w-12 rounded bg-white object-contain p-1" /><span className="font-display text-xl font-semibold">EU-AFRIC Technologies Ltd</span></a>
        <div>
          <p className="font-display text-4xl font-semibold leading-tight">Your projects,<br /><span className="text-brand-yellow">documents and payments</span><br />in one secure place.</p>
          <p className="mt-4 max-w-md text-gray-300">Track construction and solar progress, share documents, message our team and view your account — any time.</p>
        </div>
        <p className="flex items-center gap-2 text-xs text-gray-400"><ShieldCheck size={14} className="text-brand-green" />Private and encrypted. Each client sees only their own records.</p>
        <div className="absolute inset-x-0 bottom-0 h-1.5 bg-gradient-to-r from-brand-green via-brand-yellow to-brand-green" />
      </div>
      <div className="flex items-center justify-center bg-brand-grey px-4 py-10">
        <div className="w-full max-w-md">
          <a href="/" className="mb-6 flex items-center gap-2 lg:hidden"><img src="/img/logo.png" alt="" className="h-10 w-10 rounded bg-white object-contain p-0.5" /><span className="font-display font-semibold">EU-AFRIC Technologies</span></a>
          <div className="card !p-6 sm:!p-8">
            <h1 className="font-display text-2xl font-semibold text-brand-black">{title}</h1>
            {sub && <p className="mt-1 text-sm text-gray-500">{sub}</p>}
            <div className="mt-6">{children}</div>
          </div>
          <p className="mt-4 text-center text-xs text-gray-500"><a href="/" className="hover:underline">← Back to eatl.co.com</a></p>
        </div>
      </div>
    </div>
  )
}
