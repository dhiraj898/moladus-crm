/**
 * Post-payment landing (plan Task 6.2 Step 3). Razorpay redirects the customer
 * here via the payment link `callback_url` after checkout. The authoritative
 * payment state is set by the signature-verified webhook (Workstream 9); this
 * page is a friendly confirmation only and asserts nothing about payment status
 * beyond what Razorpay hands back in the query string.
 */
export const dynamic = 'force-dynamic'

export default async function ThankYouPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const status =
    typeof params.razorpay_payment_link_status === 'string'
      ? params.razorpay_payment_link_status
      : null
  const paid = status === 'paid'

  return (
    <main className="mx-auto flex min-h-screen max-w-[520px] flex-col items-center justify-center px-6 text-center">
      <div
        aria-hidden
        className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface text-2xl"
      >
        {paid ? '✓' : '✦'}
      </div>
      <h1 className="mt-6 text-2xl font-extrabold tracking-[-0.02em]">
        {paid ? 'Payment received' : 'Thank you'}
      </h1>
      <p className="mt-3 text-[15px] leading-[1.7] text-dim">
        {paid
          ? 'Your enrollment is confirmed. A confirmation has been sent to you on WhatsApp — you can safely close this page.'
          : 'We’ve received your details. If your payment is still processing, your confirmation will arrive on WhatsApp shortly. You can safely close this page.'}
      </p>
    </main>
  )
}
