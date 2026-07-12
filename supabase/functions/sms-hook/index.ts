import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

Deno.serve(async (req) => {
  // 1. Verify the request is legitimately coming from your Supabase instance
  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);
  
  // Clean prefix if your dashboard generated secret includes "v1,whsec_"
  const hookSecret = Deno.env.get("SEND_SMS_HOOK_SECRET") || "";
  const wh = new Webhook(hookSecret);
  
  try {
    // Verified payload yields user details and the generated OTP code
    const { user, sms } = wh.verify(payload, headers);
    const phoneNumber = user?.phone;
    const otpCode = sms?.otp;

    if (!phoneNumber || !otpCode) {
      return new Response("Missing details", { status: 400 });
    }

    // 2. Format your text message body
    const message = `Your verification code is: ${otpCode}. Do not share it.`;

    // 3. Send to your choice budget/free tier SMS Provider endpoint
    // (Replace URL and payload keys according to your chosen provider's API docs)
    const smsResponse = await fetch("https://api.your-sms-provider.com/v1/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("SMS_PROVIDER_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: phoneNumber,
        message: message,
      }),
    });

    if (!smsResponse.ok) {
      const errText = await smsResponse.text();
      console.error("SMS Gateway error:", errText);
      return new Response("Failed to dispatch text message", { status: 500 });
    }

    // Tell Supabase everything went through cleanly
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Webhook verification failed:", err.message);
    return new Response("Unauthorized Hook Call", { status: 401 });
  }
});