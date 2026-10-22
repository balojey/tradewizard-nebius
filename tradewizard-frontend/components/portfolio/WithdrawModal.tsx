'use client';

import { useState, useMemo, useCallback } from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle } from 'lucide-react';
import { parseUnits } from 'viem';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import usePolygonBalances from '@/hooks/usePolygonBalances';
import { usePortfolioSessions } from '@/hooks/usePortfolioSessions';
import useUsdcTransfer from '@/hooks/useUsdcTransfer';
import { useTrading } from '@/providers/TradingProvider';
import { USDC_E_DECIMALS } from '@/constants/tokens';
import { useQueryClient } from '@tanstack/react-query';

interface WithdrawModalProps {
  open: boolean;
  onClose: () => void;
}

type WithdrawStep = 'form' | 'confirm' | 'success';

export function WithdrawModal({ open, onClose }: WithdrawModalProps) {
  const { safeAddress, relayClient } = useTrading();
  const { usdcBalance } = usePolygonBalances(safeAddress);
  const { data: sessionsData } = usePortfolioSessions();
  const { isTransferring, transferUsdc } = useUsdcTransfer();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<WithdrawStep>('form');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [, setTxHash] = useState<string | null>(null);

  // Committed capital
  const committedCapital = useMemo(() => {
    if (!sessionsData?.sessions) return 0;
    return sessionsData.sessions
      .filter((s) => s.status === 'active' || s.status === 'paused')
      .reduce((sum, s) => sum + s.investmentAmount, 0);
  }, [sessionsData]);

  const available = Math.max(0, usdcBalance - committedCapital);

  // Validation
  const amountNum = parseFloat(amount) || 0;
  const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(recipient);
  const isValidAmount = amountNum > 0 && amountNum <= available;
  const canProceed = isValidAddress && isValidAmount;

  const handleSetMax = useCallback(() => {
    setAmount(available.toFixed(2));
  }, [available]);

  const handleProceedToConfirm = useCallback(() => {
    setError(null);
    if (!canProceed) return;
    setStep('confirm');
  }, [canProceed]);

  const handleConfirmWithdraw = useCallback(async () => {
    if (!relayClient || !canProceed) return;

    setError(null);
    try {
      const amountBigInt = parseUnits(amountNum.toFixed(USDC_E_DECIMALS), USDC_E_DECIMALS);

      await transferUsdc(relayClient, {
        recipient: recipient as `0x${string}`,
        amount: amountBigInt,
      });

      // Invalidate balance query to refresh
      queryClient.invalidateQueries({ queryKey: ['usdcBalance'] });

      setStep('success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transfer failed';
      setError(message);
      // Stay on confirm step so user can retry
    }
  }, [relayClient, canProceed, amountNum, recipient, transferUsdc, queryClient]);

  const handleClose = useCallback(() => {
    // Reset state on close
    setStep('form');
    setAmount('');
    setRecipient('');
    setError(null);
    setTxHash(null);
    onClose();
  }, [onClose]);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Withdraw USD"
      size="sm"
      mobileSheet
    >
      {step === 'form' && (
        <div className="flex flex-col gap-4">
          {/* Available balance info */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-surface-2/50">
            <span className="text-xs text-muted">Available to withdraw</span>
            <span className="text-sm font-mono font-semibold text-yes">
              ${available.toFixed(2)}
            </span>
          </div>

          {/* Amount input */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="withdraw-amount" className="text-xs font-medium text-muted">
              Amount (USD)
            </label>
            <div className="relative">
              <input
                id="withdraw-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                max={available}
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-3 py-2.5 pr-16 rounded-lg border border-border bg-surface text-fg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              />
              <button
                type="button"
                onClick={handleSetMax}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs font-medium text-accent hover:text-fg rounded transition-colors"
              >
                MAX
              </button>
            </div>
            {amountNum > available && (
              <span className="text-xs text-no">Exceeds available balance</span>
            )}
          </div>

          {/* Recipient address */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="withdraw-recipient" className="text-xs font-medium text-muted">
              Recipient Address (Polygon)
            </label>
            <input
              id="withdraw-recipient"
              type="text"
              placeholder="0x..."
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-surface text-fg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            />
            {recipient.length > 0 && !isValidAddress && (
              <span className="text-xs text-no">Invalid Polygon address</span>
            )}
          </div>

          {/* Action */}
          <Button
            variant="primary"
            size="lg"
            className="w-full mt-2"
            disabled={!canProceed}
            onClick={handleProceedToConfirm}
          >
            <ArrowUpRight className="w-4 h-4 mr-2" aria-hidden="true" />
            Review Withdrawal
          </Button>
        </div>
      )}

      {step === 'confirm' && (
        <div className="flex flex-col gap-4">
          {/* Summary */}
          <div className="flex flex-col gap-2 p-4 rounded-lg border border-border bg-surface-2/30">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Amount</span>
              <span className="text-sm font-mono font-semibold text-fg">
                ${amountNum.toFixed(2)} USD
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">To</span>
              <span className="text-xs font-mono text-fg truncate max-w-[180px]">
                {recipient}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Network</span>
              <span className="text-xs text-fg">Polygon</span>
            </div>
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/20">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-xs text-muted">
              Make sure the recipient address is correct. This transaction cannot be reversed.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg bg-no/10 border border-no/20">
              <p className="text-xs text-no">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              variant="ghost"
              size="md"
              className="flex-1"
              onClick={() => setStep('form')}
              disabled={isTransferring}
            >
              Back
            </Button>
            <Button
              variant="primary"
              size="md"
              className="flex-1"
              loading={isTransferring}
              onClick={handleConfirmWithdraw}
            >
              Confirm Withdrawal
            </Button>
          </div>
        </div>
      )}

      {step === 'success' && (
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="w-12 h-12 rounded-full bg-yes/15 flex items-center justify-center">
            <CheckCircle className="w-6 h-6 text-yes" aria-hidden="true" />
          </div>
          <div className="text-center">
            <h3 className="text-base font-semibold text-fg">Withdrawal Sent</h3>
            <p className="text-sm text-muted mt-1">
              ${amountNum.toFixed(2)} USD is being transferred to your wallet.
            </p>
          </div>
          <Button variant="secondary" size="md" className="w-full mt-2" onClick={handleClose}>
            Done
          </Button>
        </div>
      )}
    </Modal>
  );
}
