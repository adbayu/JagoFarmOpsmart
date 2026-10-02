import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { ProductSummary } from "../modules/products/contracts.js";
import type { SaleLotOption, SaleSummary } from "../modules/sales/contracts.js";
import {
  Card,
  ConfirmDialog,
  FormField,
  PageHeader,
  StatePanel,
} from "./components/primitives.js";
import { request, useFarms } from "./farms.js";
import { PaymentPanel } from "./finance/payments.js";

type Line = {
  id: string;
  productId: string;
  price: string;
  lotId: string;
  quantity: string;
};
const blankLine = (): Line => ({
  id: crypto.randomUUID(),
  productId: "",
  price: "",
  lotId: "",
  quantity: "",
});
const money = (value: string) =>
  `Rp ${new Intl.NumberFormat("id-ID").format(BigInt(value))}`;
export function SalesPage({ state }: { state: ReturnType<typeof useFarms> }) {
  const farmId = state.activeId;
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [lots, setLots] = useState<SaleLotOption[]>([]);
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [buyer, setBuyer] = useState("");
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString("en-CA"),
  );
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [paymentSaleId, setPaymentSaleId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelKey, setCancelKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!farmId || state.loading) {
      setProducts([]);
      setLots([]);
      setSales([]);
      return;
    }
    let current = true;
    setLoading(true);
    setError(null);
    Promise.all([
      request<ProductSummary[]>(`/api/farms/${farmId}/products`),
      request<SaleLotOption[]>(`/api/farms/${farmId}/sales/lot-options`),
      request<SaleSummary[]>(`/api/farms/${farmId}/sales`),
    ])
      .then(([productRows, lotRows, saleRows]) => {
        if (!current) return;
        setProducts(productRows);
        setLots(lotRows);
        setSales(saleRows);
      })
      .catch((cause) => {
        if (current)
          setError(
            cause instanceof Error ? cause.message : "Penjualan gagal dimuat.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [farmId, state.loading, revision]);
  const availableProducts = products.filter(
    (product) =>
      product.status === "ACTIVE" &&
      lots.some((lot) => lot.productId === product.id),
  );
  function changeLine(
    id: string,
    field: keyof Omit<Line, "id">,
    value: string,
  ) {
    setLines((rows) =>
      rows.map((row) =>
        row.id === id
          ? {
              ...row,
              [field]: value,
              ...(field === "productId"
                ? {
                    price:
                      products.find((product) => product.id === value)
                        ?.targetPriceMinor ?? "",
                    lotId: "",
                  }
                : {}),
            }
          : row,
      ),
    );
    setKey(crypto.randomUUID());
    setError(null);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farmId || pending) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const receipt = await request<{ saleId: string; totalMinor: string }>(
        `/api/farms/${farmId}/sales/complete`,
        "POST",
        {
          idempotencyKey: key,
          buyer,
          saleDate: date,
          items: lines.map((line) => ({
            productId: line.productId,
            unitPriceMinor: line.price,
            allocations: [{ lotId: line.lotId, quantity: line.quantity }],
          })),
        },
      );
      setBuyer("");
      setLines([blankLine()]);
      setKey(crypto.randomUUID());
      setMessage(
        `Penjualan selesai dengan nilai ${money(receipt.totalMinor)}. Penerimaan pembayaran dicatat terpisah.`,
      );
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Penjualan gagal disimpan.",
      );
    } finally {
      setPending(false);
    }
  }
  async function cancel() {
    if (!farmId || !cancelId || pending) return;
    if (!cancelReason.trim()) {
      setCancelError("Alasan pembatalan wajib diisi.");
      return;
    }
    setPending(true);
    setCancelError(null);
    setMessage(null);
    try {
      await request(`/api/farms/${farmId}/sales/${cancelId}/cancel`, "POST", {
        idempotencyKey: cancelKey,
        reason: cancelReason.trim(),
      });
      setCancelId(null);
      setCancelReason("");
      setCancelKey(crypto.randomUUID());
      setMessage("Penjualan dibatalkan. Stok dikembalikan ke lot asal.");
      setRevision((value) => value + 1);
    } catch (cause) {
      setCancelError(
        cause instanceof Error ? cause.message : "Penjualan gagal dibatalkan.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Operasional"
        title="Penjualan"
        visual="farm"
        description="Jual produk dari lot hasil panen. Nilai transaksi dihitung server; pembayaran dicatat terpisah."
      />
      {!state.loading && !farmId && (
        <StatePanel kind="empty" title="Belum ada farm aktif">
          Pilih farm untuk melihat penjualan.
        </StatePanel>
      )}
      {error && (
        <StatePanel
          kind="error"
          title="Penjualan belum dapat diproses"
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
      {farmId && (
        <div className="inventory-grid">
          <div className="inventory-main">
            {loading && (
              <StatePanel kind="loading" title="Memuat penjualan">
                Mengambil transaksi farm.
              </StatePanel>
            )}
            <Card title="Riwayat penjualan" className="inventory-list-card">
              {sales.length === 0 && !loading && (
                <StatePanel kind="empty" title="Belum ada penjualan">
                  Posting panen lebih dahulu agar stok produk tersedia.
                </StatePanel>
              )}
              {sales.map((sale) => (
                <article key={sale.id} className="harvest-entry">
                  <div className="harvest-entry-head">
                    <div>
                      <strong>{sale.buyer}</strong>
                      <small className="schedule-cell-meta">
                        {sale.saleDate} ·{" "}
                        {sale.status === "COMPLETED" ? "Selesai" : "Dibatalkan"}{" "}
                        · {money(sale.totalMinor)}
                      </small>
                    </div>
                    {sale.status === "COMPLETED" && (
                      <button
                        type="button"
                        className="button-danger-text"
                        disabled={pending}
                        onClick={() => {
                          setCancelId(sale.id);
                          setCancelReason("");
                          setCancelError(null);
                          setCancelKey(crypto.randomUUID());
                        }}
                      >
                        Batalkan
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setPaymentSaleId(sale.id)}
                    >
                      Pembayaran
                    </button>
                  </div>
                  {sale.items.map((item) => (
                    <div key={item.id} className="sale-item-detail">
                      <strong>
                        {item.productName} · {item.quantity} {item.unit}
                      </strong>
                      <small className="schedule-cell-meta">
                        {money(item.unitPriceMinor)} / {item.unit} · total{" "}
                        {money(item.totalMinor)}
                      </small>
                      <ul>
                        {item.allocations.map((allocation) => (
                          <li key={allocation.movementId}>
                            {allocation.quantity} {item.unit} dari lot{" "}
                            <strong>{allocation.lotLabel}</strong> · siklus{" "}
                            {allocation.cycleName} ·{" "}
                            <Link to={`/cycles/${allocation.cycleId}`}>
                              Lihat siklus
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </article>
              ))}
            </Card>
            {sales.find((sale) => sale.id === paymentSaleId) && (
              <PaymentPanel
                farmId={farmId}
                sale={sales.find((sale) => sale.id === paymentSaleId)!}
                onClose={() => setPaymentSaleId(null)}
              />
            )}
          </div>
          <Card
            title="Selesaikan penjualan"
            className="form-card inventory-form-card"
          >
            <p>
              Pilih produk dan lot untuk setiap item. Transaksi selesai langsung
              mengurangi stok. Penerimaan dan refund dicatat melalui rincian
              pembayaran transaksi.
            </p>
            {availableProducts.length === 0 && (
              <StatePanel kind="empty" title="Stok produk belum tersedia">
                Buat <Link to="/products">produk</Link> dan{" "}
                <Link to="/harvest">posting panen</Link> terlebih dahulu.
              </StatePanel>
            )}
            {availableProducts.length > 0 && (
              <form onSubmit={(event) => void save(event)}>
                <FormField id="sale-buyer" label="Pembeli">
                  <input
                    id="sale-buyer"
                    required
                    maxLength={200}
                    value={buyer}
                    onChange={(event) => {
                      setBuyer(event.target.value);
                      setKey(crypto.randomUUID());
                    }}
                  />
                </FormField>
                <FormField id="sale-date" label="Tanggal transaksi">
                  <input
                    id="sale-date"
                    type="date"
                    required
                    value={date}
                    onChange={(event) => {
                      setDate(event.target.value);
                      setKey(crypto.randomUUID());
                    }}
                  />
                </FormField>
                {lines.map((line, index) => (
                  <fieldset key={line.id} className="harvest-output">
                    <legend>Item {index + 1}</legend>
                    <FormField id={`sale-product-${line.id}`} label="Produk">
                      <select
                        id={`sale-product-${line.id}`}
                        required
                        value={line.productId}
                        onChange={(event) =>
                          changeLine(line.id, "productId", event.target.value)
                        }
                      >
                        <option value="">Pilih produk</option>
                        {availableProducts.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name} · {product.grade || "Tanpa grade"} ·{" "}
                            {product.unit}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <FormField
                      id={`sale-price-${line.id}`}
                      label="Harga per satuan (Rp)"
                    >
                      <input
                        id={`sale-price-${line.id}`}
                        type="number"
                        min="0"
                        step="1"
                        required
                        value={line.price}
                        onChange={(event) =>
                          changeLine(line.id, "price", event.target.value)
                        }
                      />
                    </FormField>
                    <FormField id={`sale-lot-${line.id}`} label="Lot">
                      <select
                        id={`sale-lot-${line.id}`}
                        required
                        value={line.lotId}
                        onChange={(event) =>
                          changeLine(line.id, "lotId", event.target.value)
                        }
                      >
                        <option value="">Pilih lot</option>
                        {lots
                          .filter((lot) => lot.productId === line.productId)
                          .map((lot) => (
                            <option key={lot.lotId} value={lot.lotId}>
                              {lot.lotLabel} · tersedia {lot.balance} {lot.unit}{" "}
                              · {lot.cycleName}
                            </option>
                          ))}
                      </select>
                    </FormField>
                    <FormField
                      id={`sale-quantity-${line.id}`}
                      label="Kuantitas"
                    >
                      <input
                        id={`sale-quantity-${line.id}`}
                        type="number"
                        min="0.001"
                        step={
                          ["HEAD", "UNIT", "SEED"].includes(
                            products.find(
                              (product) => product.id === line.productId,
                            )?.unit ?? "",
                          )
                            ? "1"
                            : "0.001"
                        }
                        required
                        value={line.quantity}
                        onChange={(event) =>
                          changeLine(line.id, "quantity", event.target.value)
                        }
                      />
                    </FormField>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        className="button-danger-text"
                        onClick={() => {
                          setLines((rows) =>
                            rows.filter((value) => value.id !== line.id),
                          );
                          setKey(crypto.randomUUID());
                        }}
                      >
                        Hapus item
                      </button>
                    )}
                  </fieldset>
                ))}
                <div className="actions">
                  <button
                    type="button"
                    disabled={lines.length >= 50}
                    onClick={() => {
                      setLines((rows) => [...rows, blankLine()]);
                      setKey(crypto.randomUUID());
                    }}
                  >
                    Tambah item
                  </button>
                  <button type="submit" disabled={pending}>
                    Selesaikan penjualan
                  </button>
                </div>
              </form>
            )}
          </Card>
        </div>
      )}
      <ConfirmDialog
        open={cancelId !== null}
        title="Batalkan penjualan?"
        busy={pending}
        onClose={() => {
          setCancelId(null);
          setCancelError(null);
        }}
        onConfirm={() => void cancel()}
      >
        <p>Stok akan kembali ke lot asal. Alasan pembatalan wajib dicatat.</p>
        <FormField
          id="sale-cancel-reason"
          label="Alasan pembatalan"
          error={cancelError ?? undefined}
        >
          <input
            id="sale-cancel-reason"
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
