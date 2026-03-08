import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';

// Raw JSON-RPC fetch (avoids ethers v5 HTTP issues in Next.js API routes)
async function rpcCall(rpcUrl: string, method: string, params: unknown[]) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message || JSON.stringify(data.error)}`);
  }
  return data.result;
}

function encodeCall(funcSig: string, address: string): string {
  const iface = new ethers.utils.Interface([`function ${funcSig}`]);
  return iface.encodeFunctionData(funcSig.split('(')[0], [address]);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { address, mode, proof } = body;

    if (!address || !ethers.utils.isAddress(address)) {
      return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
    }

    // ── World ID Proof Verification ──
    if (mode === 'worldid' && proof) {
      const rpId = process.env.WORLD_ID_RP_ID;
      if (!rpId) {
        return NextResponse.json(
          { error: 'World ID RP not configured' },
          { status: 500 }
        );
      }

      // Verify proof with World ID v4 API
      const verifyRes = await fetch(
        `https://developer.world.org/api/v4/verify/${rpId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(proof),
        }
      );

      if (!verifyRes.ok) {
        const errData = await verifyRes.json().catch(() => ({}));
        console.error('World ID v4 verify response:', JSON.stringify(errData, null, 2));
        const perProofDetail = errData.results?.[0]?.detail || '';
        const detail = errData.detail || errData.message || 'unknown error';
        return NextResponse.json(
          { error: `World ID verification failed: ${detail}${perProofDetail ? ` (${perProofDetail})` : ''}` },
          { status: 400 }
        );
      }
    }

    // ── Call mockVerify on-chain ──
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
    const rpcUrl = process.env.SERVER_RPC_URL?.trim();
    const gateAddress = process.env.WORLD_ID_GATE_ADDRESS?.trim();

    if (!privateKey || !rpcUrl || !gateAddress) {
      return NextResponse.json(
        { error: 'Server not configured for on-chain verification' },
        { status: 500 }
      );
    }

    // Check if already verified
    const isVerifiedData = encodeCall('isVerified(address)', address);
    const isVerifiedResult = await rpcCall(rpcUrl, 'eth_call', [
      { to: gateAddress, data: isVerifiedData },
      'latest',
    ]);

    const alreadyVerified = isVerifiedResult && BigInt(isVerifiedResult) === 1n;
    if (alreadyVerified) {
      return NextResponse.json({ success: true, message: 'Already verified' });
    }

    // Build and sign mockVerify transaction
    const wallet = new ethers.Wallet(privateKey);
    const mockVerifyData = encodeCall('mockVerify(address)', address);

    const [nonce, gasPrice, chainId] = await Promise.all([
      rpcCall(rpcUrl, 'eth_getTransactionCount', [wallet.address, 'latest']),
      rpcCall(rpcUrl, 'eth_gasPrice', []),
      rpcCall(rpcUrl, 'eth_chainId', []),
    ]);

    let gasLimit: string;
    try {
      gasLimit = await rpcCall(rpcUrl, 'eth_estimateGas', [
        { from: wallet.address, to: gateAddress, data: mockVerifyData },
      ]);
    } catch {
      gasLimit = '0x30000';
    }

    const tx = {
      to: gateAddress,
      data: mockVerifyData,
      nonce: parseInt(nonce, 16),
      gasLimit: ethers.BigNumber.from(gasLimit).mul(120).div(100),
      gasPrice: ethers.BigNumber.from(gasPrice),
      chainId: parseInt(chainId, 16),
    };

    const signedTx = await wallet.signTransaction(tx);
    const txHash = await rpcCall(rpcUrl, 'eth_sendRawTransaction', [signedTx]);

    // Wait for receipt
    let receipt = null;
    for (let i = 0; i < 30; i++) {
      receipt = await rpcCall(rpcUrl, 'eth_getTransactionReceipt', [txHash]);
      if (receipt) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!receipt || receipt.status === '0x0') {
      return NextResponse.json(
        { error: 'Transaction reverted on-chain' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      txHash,
      message: mode === 'worldid'
        ? 'Verified via World ID + on-chain mockVerify'
        : 'Verified via demo mode (mockVerify)',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('World ID verification error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
