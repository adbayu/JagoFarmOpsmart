import { useEffect, useState, type FormEvent } from "react";
import type {
  PaymentBalance,
  PaymentSummary,
} from "../../modules/finance/payment-contracts.js";
import type { SaleSummary } from "../../modules/sales/contracts.js";
import {
  Card,
  ConfirmDialog,
  FormField,
  StatePanel,
} from "../components/primitives.js";
import { request } from "../farms.js";

const money = (value: string) =>
  `Rp ${new Intl.NumberFormat("id-ID").format(BigInt(value))}`;
export function PaymentPanel({
  farmId,
  sale,
  onClose,
}: {
  farmId: string;
  sale: SaleSummary;
  onClose: () => void;
}) {
  const [balance, setBalance] = useState<PaymentBalance | null>(null);
  const [kind, setKind] = useState<"PAYMENT" | "REFUND">("PAYMENT");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString("en-CA"),
  );
  const [sourceKey, setSourceKey] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [confirm, setConfirm] = useState<PaymentSummary | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelKey, setCancelKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setBalance(null);
    setError(null);
    request<PaymentBalance>(`/api/farms/${farmId}/sales/${sale.id}/payments`)
      .then((result) => {
        if (current) setBalance(result);
      })
      .catch((cause) => {
        if (current)
          setError(
            cause instanceof Error ? cause.message : "Pembayaran gagal dimuat.",
          );
      });
    return () => {
      current = false;
    };
  }, [farmId, sale.id, revision]);
  function change(setter: (value: string) => void, value: string) {
    setter(value);
    setKey(crypto.randomUUID());
    setError(null);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || sale.status !== "COMPLETED") return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await request(
        `/api/farms/${farmId}/sales/${sale.id}/${kind === "PAYMENT" ? "payments" : "refunds"}`,
        "POST",
        {
          idempotencyKey: key,
          sourceKey,
          amountMinor: amount,
          paymentDate: date,
          notes: notes.trim() || undefined,
          ...(kind === "REFUND" ? { reason } : {}),
        },
      );
      setAmount("");
      setSourceKey("");
      setReason("");
      setNotes("");
      setKey(crypto.randomUUID());
      setMessage(
        kind === "PAYMENT" ? "Penerimaan tercatat." : "Refund tercatat.",
      );
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Pembayaran gagal dicatat.",
      );
    } finally {
      setPending(false);
    }
  }
  async function cancel() {
    if (!confirm || pending) return;
    if (!cancelReason.trim()) {
      setCancelError("Alasan pembatalan wajib diisi.");
      return;
    }
    setPending(true);
    setCancelError(null);
    setMessage(null);
    try {
      await request(
        `/api/farms/${farmId}/payments/${confirm.id}/cancel`,
        "POST",
        { idempotencyKey: cancelKey, reason: cancelReason.trim() },
      );
      setConfirm(null);
      setCancelReason("");
      setCancelKey(crypto.randomUUID());
      setMessage("Catatan pembayaran dibatalkan dengan alasan audit.");
      setRevision((value) => value + 1);
    } catch (cause) {
      setCancelError(
        cause instanceof Error ? cause.message : "Pembatalan gagal.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Card title={`Pembayaran · ${sale.buyer}`} className="payment-panel">
        <button type="button" className="text-button" onClick={onClose}>
          Tutup rincian
        </button>
        {!balance && !error && (
          <StatePanel kind="loading" title="Memuat pembayaran">
            Mengambil catatan pembayaran.
          </StatePanel>
        )}
        {error && (
          <StatePanel
            kind="error"
            title="Pembayaran belum dapat diproses"
            onRetry={() => setRevision((value) => value + 1)}
          >
            {error}
          </StatePanel>
        )}
        {message && (
          <StatePanel kind="success" title="Tersimpan">
            {message}
          </StatePanel>
        )}
        {balance && (
          <>
            <p>
              <strong>
                {balance.status === "PAID"
                  ? "Lunas"
                  : balance.status === "PARTIAL"
                    ? "Sebagian"
                    : "Belum dibayar"}
              </strong>{" "}
              · diterima bersih {money(balance.netReceivedMinor)} dari{" "}
              {money(balance.saleTotalMinor)}.
            </p>
            <p>
              Catatan ini mencerminkan kas diterima, bukan aturan pengakuan
              pendapatan.
            </p>
            {balance.payments.length === 0 ? (
              <p>Belum ada pembayaran.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <caption>Riwayat penerimaan dan refund</caption>
                  <thead>
                    <tr>
                      <th>Tanggal</th>
                      <th>Jenis</th>
                      <th>Nominal</th>
                      <th>Bukti</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {balance.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td>{payment.paymentDate}</td>
                        <td>
                          {payment.kind === "PAYMENT" ? "Penerimaan" : "Refund"}
                          {payment.reason && (
                            <small className="schedule-cell-meta">
                              {payment.reason}
                            </small>
                          )}
                        </td>
                        <td>{money(payment.amountMinor)}</td>
                        <td>{payment.sourceKey}</td>
                        <td>
                          {payment.status === "POSTED"
                            ? "Aktif"
                            : `Dibatalkan: ${payment.cancelReason}`}
                        </td>
                        <td>
                          {payment.status === "POSTED" &&
                            sale.status === "COMPLETED" && (
                              <button
                                type="button"
                                className="button-danger-text"
                                onClick={() => {
                                  setConfirm(payment);
                                  setCancelReason("");
                                  setCancelError(null);
                                  setCancelKey(crypto.randomUUID());
                                }}
                              >
                                Batalkan
                              </button>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {sale.status === "COMPLETED" && (
              <form
                onSubmit={(event) => void save(event)}
                className="payment-form"
              >
                <h3>Catat penerimaan / refund</h3>
                <FormField id="payment-kind" label="Jenis">
                  <select
                    id="payment-kind"
                    value={kind}
                    onChange={(event) => {
                      setKind(event.target.value as "PAYMENT" | "REFUND");
                      setKey(crypto.randomUUID());
                    }}
                  >
                    <option value="PAYMENT">Penerimaan</option>
                    <option value="REFUND">Refund</option>
                  </select>
                </FormField>
                <FormField id="payment-amount" label="Nominal (Rp)">
                  <input
                    id="payment-amount"
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={amount}
                    onChange={(event) => change(setAmount, event.target.value)}
                  />
                </FormField>
                <FormField id="payment-date" label="Tanggal">
                  <input
                    id="payment-date"
                    type="date"
                    required
                    value={date}
                    onChange={(event) => change(setDate, event.target.value)}
                  />
                </FormField>
                <FormField id="payment-source" label="Nomor bukti unik">
                  <input
                    id="payment-source"
                    required
                    maxLength={200}
                    value={sourceKey}
                    onChange={(event) =>
                      change(setSourceKey, event.target.value)
                    }
                  />
                </FormField>
                {kind === "REFUND" && (
                  <FormField id="payment-reason" label="Alasan refund">
                    <input
                      id="payment-reason"
                      required
                      maxLength={500}
                      value={reason}
                      onChange={(event) =>
                        change(setReason, event.target.value)
                      }
                    />
                  </FormField>
                )}
                <FormField id="payment-notes" label="Catatan (opsional)">
                  <textarea
                    id="payment-notes"
                    maxLength={2000}
                    value={notes}
                    onChange={(event) => change(setNotes, event.target.value)}
                  />
                </FormField>
                <div className="actions">
                  <button type="submit" disabled={pending}>
                    {kind === "PAYMENT" ? "Catat penerimaan" : "Catat refund"}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </Card>
      <ConfirmDialog
        open={confirm !== null}
        title="Batalkan catatan pembayaran?"
        busy={pending}
        onClose={() => {
          setConfirm(null);
          setCancelError(null);
        }}
        onConfirm={() => void cancel()}
      >
        <p>Catatan asal tetap ada dengan status dibatalkan.</p>
        <FormField
          id="payment-cancel-reason"
          label="Alasan pembatalan"
          error={cancelError ?? undefined}
        >
          <input
            id="payment-cancel-reason"
            required
            maxLength={500}
            value={cancelReason}
            onChange={(event) => {
              setCancelReason(event.target.value);
              setCancelError(null);
              setCancelKey(crypto.randomUUID());
            }}
          />
        </FormField>
      </ConfirmDialog>
    </>
  );
}
