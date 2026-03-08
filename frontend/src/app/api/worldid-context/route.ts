import { NextRequest, NextResponse } from 'next/server';
import { signRequest } from '@worldcoin/idkit/signing';

export async function POST(req: NextRequest) {
  try {
    const { action } = await req.json();

    const appId = process.env.WORLD_ID_APP_ID;
    const rpId = process.env.WORLD_ID_RP_ID;
    const signingKey = process.env.WORLD_ID_SIGNING_KEY;

    if (!appId || !rpId || !signingKey) {
      return NextResponse.json(
        { error: 'World ID RP credentials not configured.' },
        { status: 500 }
      );
    }

    // Sign the request using IDKit v4 signRequest
    const sig = signRequest(action || 'prism-verify', signingKey, 300);

    const rp_context = {
      rp_id: rpId,
      nonce: sig.nonce,
      created_at: sig.createdAt,
      expires_at: sig.expiresAt,
      signature: sig.sig,
    };

    return NextResponse.json({
      app_id: appId,
      rp_context,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('World ID context error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
