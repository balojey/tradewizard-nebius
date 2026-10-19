"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Check, Wallet, Bitcoin, CircleDollarSign } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useTrading } from "@/providers/TradingProvider";
import {
  useBridgeAssets,
  useBridgeDepositAddresses,
} from "@/hooks/useBridge";

interface DepositModalProps {
  open: boolean;
  onClose: () => void;
}

type AddressKey = "evm" | "svm" | "btc" | "tron";

const ADDRESS_TABS: Array<{
  key: AddressKey;
  label: string;
  hint: string;
}> = [
  {
    key: "evm",
    label: "EVM",
    hint: "Ethereum, Polygon, Arbitrum, Base, Optimism, BNB Chain",
  },
  { key: "svm", label: "Solana", hint: "Solana" },
  { key: "btc", label: "Bitcoin", hint: "Bitcoin" },
  { key: "tron", label: "Tron", hint: "Tron (USDT)" },
];

function addressTypeForChain(chainName: string): AddressKey {
  const chain = chainName.toLowerCase();
  if (chain.includes("solana")) return "svm";
  if (chain.includes("bitcoin")) return "btc";
  if (chain.includes("tron")) return "tron";
  return "evm";
}

export function DepositModal({ open, onClose }: DepositModalProps) {
  const { safeAddress } = useTrading();
  const { mutate, data, isPending, error, reset } = useBridgeDepositAddresses();
  const { data: assetsData, isLoading: assetsLoading } = useBridgeAssets();
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<AddressKey>("evm");
  const [showAssets, setShowAssets] = useState(false);

  useEffect(() => {
    if (open && safeAddress) {
      reset();
      mutate({ address: safeAddress });
    }
  }, [open, safeAddress, mutate, reset]);

  const availableTabs = useMemo(
    () => ADDRESS_TABS.filter((tab) => !!data?.address?.[tab.key]),
    [data]
  );

  // Keep the effective selection valid as addresses arrive.
  const effectiveSelected: AddressKey = data?.address?.[selected]
    ? selected
    : (availableTabs[0]?.key ?? selected);

  const activeTab = ADDRESS_TABS.find((tab) => tab.key === effectiveSelected);
  const address = data?.address?.[effectiveSelected];

  const supportedAssets = useMemo(
    () =>
      (assetsData?.supportedAssets ?? []).filter(
        (asset) => addressTypeForChain(asset.chainName) === effectiveSelected
      ),
    [assetsData, effectiveSelected]
  );

  const handleCopy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal open={open} onClose={onClose} title="Add funds" size="sm" mobileSheet>
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-surface-2/50">
          <Wallet className="w-4 h-4 text-accent shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-xs text-muted">
            Send supported assets from any chain. They are converted to USD in
            your Trading Wallet automatically.
          </p>
        </div>

        {isPending && (
          <div className="h-16 rounded-lg bg-surface-2 animate-pulse" />
        )}

        {error && (
          <div className="p-3 rounded-lg bg-no/10 border border-no/20">
            <p className="text-xs text-no">{error.message}</p>
          </div>
        )}

        {availableTabs.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">
              Where are you sending from?
            </span>
            <div className="grid grid-cols-4 gap-1.5">
              {availableTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setSelected(tab.key);
                    setCopied(false);
                  }}
                  className={
                    "px-2 py-2 rounded-lg border text-xs font-medium transition-colors " +
                    (effectiveSelected === tab.key
                      ? "border-accent bg-accent/10 text-fg"
                      : "border-border bg-surface text-muted hover:text-fg")
                  }
                  aria-pressed={effectiveSelected === tab.key}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {activeTab && (
              <span className="text-[11px] text-muted">{activeTab.hint}</span>
            )}
          </div>
        )}

        {address && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">
              {activeTab?.label} deposit address
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-surface hover:border-accent/40 transition-colors text-left"
            >
              <span className="text-xs font-mono text-fg break-all flex-1">
                {address}
              </span>
              {copied ? (
                <Check className="w-3.5 h-3.5 text-yes shrink-0" aria-hidden="true" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-muted shrink-0" aria-hidden="true" />
              )}
            </button>
            {(effectiveSelected === "btc" || effectiveSelected === "tron") && (
              <span className="flex items-center gap-1 text-[11px] text-muted">
                <Bitcoin className="w-3 h-3" aria-hidden="true" />
                Only send {activeTab?.label} assets to this address.
              </span>
            )}
          </div>
        )}

        {data?.note && (
          <p className="flex items-start gap-1.5 text-xs text-muted">
            <CircleDollarSign className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            {data.note}
          </p>
        )}

        <div className="border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setShowAssets((value) => !value)}
            className="flex w-full items-center justify-between text-xs font-medium text-muted hover:text-fg transition-colors"
            aria-expanded={showAssets}
          >
            <span>What can I deposit?</span>
            <span aria-hidden="true">{showAssets ? "−" : "+"}</span>
          </button>

          {showAssets && (
            <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {assetsLoading && (
                <div className="p-3 text-xs text-muted">Loading supported assets…</div>
              )}
              {!assetsLoading && supportedAssets.length === 0 && (
                <div className="p-3 text-xs text-muted">
                  No supported assets found for this network.
                </div>
              )}
              {supportedAssets.map((asset) => (
                <div
                  key={`${asset.chainId}-${asset.token.address}`}
                  className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-fg truncate">
                      {asset.token.symbol}
                    </p>
                    <p className="text-[11px] text-muted truncate">
                      {asset.token.name} · {asset.chainName}
                    </p>
                  </div>
                  <span className="text-[11px] text-muted whitespace-nowrap">
                    Min ${asset.minCheckoutUsd}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <Button variant="secondary" size="md" className="w-full" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
