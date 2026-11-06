import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { CommoditySummary } from "../modules/farming/contracts.js";
import type {
  ProductItemOption,
  ProductSummary,
} from "../modules/products/contracts.js";
import {
  Card,
  ConfirmDialog,
  DataTable,
  FormField,
  PageHeader,
  StatePanel,
} from "./components/primitives.js";
import { request, useFarms } from "./farms.js";

type Draft = {
  itemId: string;
  commodityId: string;
  name: string;
  grade: string;
  price: string;
};
const blank = (): Draft => ({
  itemId: "",
  commodityId: "",
  name: "",
  grade: "",
  price: "",
});
const typeLabel = { FISH: "Ikan", CHICKEN: "Ayam", CROP: "Tanaman" };
const displayPrice = (value: string | null) =>
  value === null
    ? "Belum ditetapkan"
    : `Rp ${new Intl.NumberFormat("id-ID").format(BigInt(value))}`;
export function ProductsPage({
  state,
}: {
  state: ReturnType<typeof useFarms>;
}) {
  const farmId = state.activeId;
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [items, setItems] = useState<ProductItemOption[]>([]);
  const [commodities, setCommodities] = useState<CommoditySummary[]>([]);
  const [draft, setDraft] = useState<Draft>(blank);
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [toggleKey, setToggleKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!farmId || state.loading) {
      setProducts([]);
      setItems([]);
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      request<ProductSummary[]>(`/api/farms/${farmId}/products`),
      request<ProductItemOption[]>(`/api/farms/${farmId}/product-item-options`),
      request<CommoditySummary[]>(`/api/farms/${farmId}/commodities`),
    ])
      .then(([productData, itemData, commodityData]) => {
        if (!current) return;
        setProducts(productData);
        setItems(itemData);
        setCommodities(commodityData);
        if (!editId)
          setDraft((previous) => ({
            ...previous,
            itemId: itemData.some((item) => item.id === previous.itemId)
              ? previous.itemId
              : (itemData[0]?.id ?? ""),
            commodityId: commodityData.some(
              (value) => value.id === previous.commodityId,
            )
              ? previous.commodityId
              : (commodityData[0]?.id ?? ""),
          }));
      })
      .catch((cause) => {
        if (current)
          setLoadError(
            cause instanceof Error
              ? cause.message
              : "Produk belum dapat dimuat.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [farmId, state.loading, revision]);
  function change<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setKey(crypto.randomUUID());
    setError(null);
  }
  function reset() {
    setDraft(blank());
    setEditId(null);
    setKey(crypto.randomUUID());
    setRevision((value) => value + 1);
  }
  function edit(product: ProductSummary) {
    setEditId(product.id);
    setDraft({
      itemId: product.inventoryItemId,
      commodityId: product.commodityId,
      name: product.name,
      grade: product.grade ?? "",
      price: product.targetPriceMinor ?? "",
    });
    setKey(crypto.randomUUID());
    setError(null);
    setMessage(null);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farmId || pending) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      if (editId) {
        const current = products.find((product) => product.id === editId);
        if (!current) return;
        await request(`/api/farms/${farmId}/products/${editId}`, "PATCH", {
          idempotencyKey: key,
          name: draft.name,
          grade: draft.grade || null,
          targetPriceMinor: draft.price || null,
          status: current.status,
        });
      } else {
        await request(`/api/farms/${farmId}/products`, "POST", {
          idempotencyKey: key,
          inventoryItemId: draft.itemId,
          commodityId: draft.commodityId,
          name: draft.name,
          grade: draft.grade || undefined,
          targetPriceMinor: draft.price || undefined,
        });
      }
      setMessage(
        editId
          ? "Perubahan produk tersimpan."
          : "Produk dibuat. Saldo stok tetap nol sampai panen diposting.",
      );
      reset();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Produk gagal disimpan.",
      );
    } finally {
      setPending(false);
    }
  }
  async function toggle(product: ProductSummary) {
    if (!farmId || pending) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await request<ProductSummary>(
        `/api/farms/${farmId}/products/${product.id}`,
        "PATCH",
        {
          idempotencyKey: toggleKey,
          name: product.name,
          grade: product.grade,
          targetPriceMinor: product.targetPriceMinor,
          status: product.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
        },
      );
      setProducts((current) =>
        current.map((value) => (value.id === updated.id ? updated : value)),
      );
      setConfirmId(null);
      setToggleKey(crypto.randomUUID());
      setMessage(
        updated.status === "ACTIVE"
          ? "Produk aktif kembali."
          : "Produk dinonaktifkan tanpa menghapus riwayat.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Status produk gagal diubah.",
      );
    } finally {
      setPending(false);
    }
  }
  const current = products.find((product) => product.id === confirmId);
  const selectedItem = items.find((item) => item.id === draft.itemId);
  return (
    <>
      <PageHeader
        eyebrow="Operasional"
        title="Produk"
        description="Tentukan produk hasil farm per komoditas dan grade. Harga acuan terpisah dari saldo stok."
        visual="harvest"
      />
      {!state.loading && !farmId && (
        <StatePanel kind="empty" title="Belum ada farm aktif">
          Pilih farm untuk mengelola produk.
        </StatePanel>
      )}
      {error && (
        <StatePanel kind="error" title="Perubahan produk gagal">
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
              <StatePanel kind="loading" title="Memuat produk">
                Sedang mengambil katalog farm.
              </StatePanel>
            )}
            {loadError && (
              <StatePanel
                kind="error"
                title="Katalog belum dapat dimuat"
                onRetry={() => setRevision((value) => value + 1)}
              >
                {loadError}
              </StatePanel>
            )}
            <Card title="Katalog produk" className="inventory-list-card">
              <DataTable
                caption="Produk farm"
                rows={products}
                rowKey={(product) => product.id}
                emptyMessage="Belum ada produk. Buat item hasil panen terlebih dahulu."
                columns={[
                  {
                    key: "name",
                    label: "Produk",
                    render: (product) => (
                      <span>
                        <strong>{product.name}</strong>
                        <small className="schedule-cell-meta">
                          {product.grade ?? "Tanpa grade"} ·{" "}
                          {product.inventoryItemName}
                        </small>
                      </span>
                    ),
                  },
                  {
                    key: "commodity",
                    label: "Komoditas",
                    render: (product) =>
                      `${product.commodityName} · ${typeLabel[product.type]}`,
                  },
                  {
                    key: "unit",
                    label: "Satuan",
                    render: (product) => product.unit,
                  },
                  {
                    key: "price",
                    label: "Harga acuan",
                    render: (product) => displayPrice(product.targetPriceMinor),
                  },
                  {
                    key: "status",
                    label: "Status",
                    render: (product) =>
                      product.status === "ACTIVE" ? "Aktif" : "Nonaktif",
                  },
                  {
                    key: "action",
                    label: "",
                    render: (product) => (
                      <div className="table-actions">
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => edit(product)}
                        >
                          Ubah
                        </button>
                        <button
                          type="button"
                          className={
                            product.status === "ACTIVE"
                              ? "button-danger-text"
                              : "text-button"
                          }
                          disabled={pending}
                          onClick={() => {
                            setConfirmId(product.id);
                            setToggleKey(crypto.randomUUID());
                          }}
                        >
                          {product.status === "ACTIVE"
                            ? "Nonaktifkan"
                            : "Aktifkan"}
                        </button>
                      </div>
                    ),
                  },
                ]}
              />
            </Card>
          </div>
          <Card
            title={editId ? "Ubah produk" : "Buat produk"}
            className="form-card inventory-form-card"
          >
            <p>
              Satu item hasil panen untuk satu produk/grade. Buat item lain
              untuk grade berbeda. Grade yang sudah dipakai panen atau penjualan
              tidak dapat diubah.
            </p>
            {!editId && items.length === 0 && (
              <StatePanel kind="empty" title="Item hasil panen belum tersedia">
                Buat item berkategori Hasil panen di{" "}
                <Link to="/inventory">Persediaan</Link>.
              </StatePanel>
            )}
            {!editId && commodities.length === 0 && (
              <StatePanel kind="empty" title="Komoditas belum tersedia">
                Buat komoditas di <Link to="/cycles">Siklus</Link>.
              </StatePanel>
            )}
            {(editId || (items.length > 0 && commodities.length > 0)) && (
              <form onSubmit={(event) => void save(event)}>
                {!editId && (
                  <>
                    <FormField id="product-item" label="Item hasil panen">
                      <select
                        id="product-item"
                        required
                        value={draft.itemId}
                        onChange={(event) =>
                          change("itemId", event.target.value)
                        }
                      >
                        {items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {item.unit}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <FormField id="product-commodity" label="Komoditas">
                      <select
                        id="product-commodity"
                        required
                        value={draft.commodityId}
                        onChange={(event) =>
                          change("commodityId", event.target.value)
                        }
                      >
                        {commodities.map((value) => (
                          <option key={value.id} value={value.id}>
                            {value.name} · {typeLabel[value.type]}
                          </option>
                        ))}
                      </select>
                    </FormField>
                  </>
                )}
                <FormField id="product-name" label="Nama produk">
                  <input
                    id="product-name"
                    required
                    maxLength={120}
                    value={draft.name}
                    onChange={(event) => change("name", event.target.value)}
                  />
                </FormField>
                <FormField id="product-grade" label="Grade (opsional)">
                  <input
                    id="product-grade"
                    maxLength={60}
                    value={draft.grade}
                    onChange={(event) => change("grade", event.target.value)}
                  />
                </FormField>
                <FormField
                  id="product-price"
                  label={`Harga acuan per ${selectedItem?.unit ?? products.find((value) => value.id === editId)?.unit ?? "satuan"} (Rp, opsional)`}
                >
                  <input
                    id="product-price"
                    type="number"
                    min="0"
                    step="1"
                    value={draft.price}
                    onChange={(event) => change("price", event.target.value)}
                  />
                </FormField>
                <div className="actions">
                  {editId && (
                    <button type="button" disabled={pending} onClick={reset}>
                      Batal edit
                    </button>
                  )}
                  <button type="submit" disabled={pending}>
                    {editId ? "Simpan produk" : "Buat produk"}
                  </button>
                </div>
              </form>
            )}
          </Card>
        </div>
      )}
      <ConfirmDialog
        open={confirmId !== null}
        title={
          current?.status === "ACTIVE"
            ? "Nonaktifkan produk?"
            : "Aktifkan produk?"
        }
        onClose={() => setConfirmId(null)}
        onConfirm={() => {
          if (current) void toggle(current);
        }}
      >
        Status dapat diubah lagi. Riwayat panen dan penjualan tetap tersimpan.
      </ConfirmDialog>
    </>
  );
}
