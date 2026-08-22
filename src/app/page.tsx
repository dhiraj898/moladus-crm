export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[880px] flex-col justify-center px-6 py-24">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
        Moladus
      </p>
      <h1 className="mt-3 text-4xl font-extrabold tracking-[-0.03em]">
        Molecule Enrollment
      </h1>
      <p className="mt-4 max-w-[540px] text-[15.5px] leading-[1.7] text-dim">
        Product-linked enrollment forms with GST-correct pricing, hosted
        checkout, and transactional WhatsApp. Admin lives under{' '}
        <code className="rounded-[6px] bg-chip-bg px-2 py-0.5 text-sm">
          /admin
        </code>
        ; public forms are served from{' '}
        <code className="rounded-[6px] bg-chip-bg px-2 py-0.5 text-sm">
          /f/&lt;slug&gt;
        </code>
        .
      </p>
    </main>
  )
}
