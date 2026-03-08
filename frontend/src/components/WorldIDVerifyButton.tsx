'use client';

import { useState, useCallback, useRef } from 'react';
import { IDKitRequestWidget, deviceLegacy } from '@worldcoin/idkit';

interface WorldIDVerifyButtonProps {
  address: string;
  onVerified?: () => void;
}

type VerifyState = 'idle' | 'loading' | 'widget' | 'success' | 'error';

export default function WorldIDVerifyButton({ address, onVerified }: WorldIDVerifyButtonProps) {
  const [state, setState] = useState<VerifyState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [rpContext, setRpContext] = useState<{
    rp_id: string;
    nonce: string;
    created_at: number;
    expires_at: number;
    signature: string;
  } | null>(null);
  const [appId, setAppId] = useState<string>('');

  const handleClick = useCallback(async () => {
    setState('loading');
    setError(null);
    verifyingRef.current = false;

    const worldIdEnabled = process.env.NEXT_PUBLIC_WORLD_ID_ENABLED?.trim() === 'true';

    if (!worldIdEnabled) {
      // ── Demo Mode: Direct mockVerify via API ──
      try {
        const res = await fetch('/api/verify-worldid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, mode: 'demo' }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Demo verification failed');
        }
        setState('success');
        onVerified?.();
      } catch (err) {
        setState('error');
        setError(err instanceof Error ? err.message : 'Verification failed');
      }
      return;
    }

    // ── Production Mode: Fetch rp_context then open Widget ──
    try {
      const ctxRes = await fetch('/api/worldid-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: (process.env.NEXT_PUBLIC_WORLD_ID_ACTION || 'prism-verify').trim() }),
      });
      if (!ctxRes.ok) throw new Error('Failed to get World ID context');
      const { rp_context, app_id } = await ctxRes.json();
      setRpContext(rp_context);
      setAppId(app_id);
      setState('widget');
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'Failed to initialize World ID');
    }
  }, [address, onVerified]);

  // Guard against React Strict Mode double-invoking handleVerify
  const verifyingRef = useRef(false);

  // Called by the Widget after user completes World App verification.
  // Sends the proof to our backend for verification + on-chain mockVerify.
  const handleVerify = useCallback(
    async (result: unknown) => {
      if (verifyingRef.current) {
        console.log('[WorldID] handleVerify called again — skipping duplicate');
        return;
      }
      verifyingRef.current = true;

      console.log('[WorldID] handleVerify called with result:', JSON.stringify(result, null, 2));
      try {
        const res = await fetch('/api/verify-worldid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proof: result,
            address,
            mode: 'worldid',
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          console.error('[WorldID] Backend verification failed:', data);
          verifyingRef.current = false;
          throw new Error(data.error || 'Verification failed');
        }
        console.log('[WorldID] Backend verification succeeded');
      } catch (err) {
        verifyingRef.current = false;
        throw err;
      }
    },
    [address],
  );

  const handleSuccess = useCallback(
    (result: unknown) => {
      console.log('[WorldID] onSuccess called:', result);
      setState('success');
      onVerified?.();
    },
    [onVerified],
  );

  const handleError = useCallback((errorCode: unknown) => {
    console.error('[WorldID] onError called with code:', errorCode);
    setState('error');
    setError(`World ID error: ${errorCode || 'unknown'}`);
  }, []);

  if (state === 'success') {
    return (
      <div className="w-full px-4 py-3 bg-green-600/20 border border-green-500/50 text-green-400 rounded-lg font-medium text-center">
        World ID Verified
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleClick}
        disabled={state === 'loading' || state === 'widget'}
        className={`w-full px-4 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
          state === 'loading' || state === 'widget'
            ? 'bg-gray-600 text-gray-300 cursor-wait'
            : 'bg-blue-600 hover:bg-blue-700 text-white'
        }`}
      >
        {state === 'loading' ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading...
          </>
        ) : state === 'widget' ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Waiting for World ID...
          </>
        ) : (
          <>
            <WorldIDIcon />
            Verify with World ID
          </>
        )}
      </button>

      {state === 'widget' && rpContext && (
        <IDKitRequestWidget
          app_id={appId.trim() as `app_${string}`}
          action={(process.env.NEXT_PUBLIC_WORLD_ID_ACTION || 'prism-verify').trim()}
          rp_context={rpContext}
          preset={deviceLegacy({ signal: address })}
          environment="production"
          allow_legacy_proofs={true}
          open={true}
          onOpenChange={(open: boolean) => {
            if (!open) setState('idle');
          }}
          handleVerify={handleVerify}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      )}

      {state === 'error' && error && (
        <p className="text-red-400 text-xs text-center">{error}</p>
      )}
    </div>
  );
}

function WorldIDIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </svg>
  );
}
