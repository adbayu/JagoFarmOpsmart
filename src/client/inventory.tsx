import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { inventoryCategories, units } from "../shared/domain.js";
import type {
  InventoryItemSummary,
  InventoryLotSummary,
} from "../modules/inventory/contracts.js";
import {
  Card,
  ConfirmDialog,
  DataTable,
  FormField,
  PageHeader,
  StatePanel,
} from "./components/primitives.js";
import { request, useFarms } from "./farms.js";
import { formatDecimal } from "./units.js";
import { InventoryMovements } from "./inventory-movements.js";

const categoryLabels: Record<(typeof inventoryCategories)[number], string> = {
  SEED: "Benih tanaman",
  LIVESTOCK_SEED: "Bibit ternak / ikan",
  FEED: "Pakan",
  FERTILIZER: "Pupuk",
  NUTRIENT: "Nutrisi",
  MEDICINE: "Obat",
  VITAMIN: "Vitamin",
  EQUIPMENT: "Peralatan",
  HARVEST_PRODUCT: "Hasil panen",
};
const unitLabels: Record<(typeof units)[number], string> = {
  KG: "kg",
  G: "g",
  L: "L",
  ML: "mL",
  UNIT: "unit",
  HEAD: "ekor",
  SEED: "benih",
};
type ItemDraft = {
  name: string;
  category: InventoryItemSummary["category"];
  unit: InventoryItemSummary["unit"];
  minimumStock: string;
};
function blankItem(): ItemDraft {
  return { name: "", category: "FEED", unit: "KG", minimumStock: "0" };
}
type LotDraft = { label: string; location: string; expiresOn: string };
const blankLot = (): LotDraft => ({ label: "", location: "", expiresOn: "" });

export function InventoryPage({
  state,
}: {
  state: ReturnType<typeof useFarms>;
}) {
  const farmId = state.activeId;
  const navigate = useNavigate();
  const [items, setItems] = useState<InventoryItemSummary[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [draft, setDraft] = useState<ItemDraft>(blankItem);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setOffset(0);
    setItems([]);
  }, [farmId]);
  useEffect(() => {
    if (!farmId || state.loading) {
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    setError(null);
    request<{ items: InventoryItemSummary[]; nextOffset: number | null }>(
      `/api/farms/${farmId}/items?limit=50&offset=${offset}`,
    )
      .then((data) => {
        if (!current) return;
        setItems((previous) =>
          offset === 0 ? data.items : [...previous, ...data.items],
        );
        setNextOffset(data.nextOffset);
      })
      .catch((cause) => {
        if (current)
          setError(
            cause instanceof Error ? cause.message : "Gagal memuat persediaan.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [farmId, state.loading, offset, revision]);
  function change<K extends keyof ItemDraft>(field: K, value: ItemDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setKey(crypto.randomUUID());
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farmId || pending) return;
    setPending(true);
    setActionError(null);
    try {
      const item = await request<InventoryItemSummary>(
        `/api/farms/${farmId}/items`,
        "POST",
        {
          idempotencyKey: key,
          ...draft,
        },
      );
      setKey(crypto.randomUUID());
      setDraft(blankItem());
      navigate(`/inventory/${item.id}`);
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Gagal membuat item.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Operasional / Persediaan"
        title="Persediaan"
        description="Kelola item dan lot. Saldo berasal dari pergerakan stok yang tercatat."
        visual="farm"
      />
      {!state.loading && !farmId && (
        <StatePanel kind="empty" title="Belum ada farm aktif">
          Pilih farm untuk mengelola persediaan.
        </StatePanel>
      )}
      {actionError && (
        <StatePanel kind="error" title="Item belum tersimpan">
          {actionError}
        </StatePanel>
      )}
      {farmId && (
        <div className="inventory-grid">
          <div className="inventory-main">
            {loading && offset === 0 && (
              <StatePanel kind="loading" title="Memuat persediaan">
                Sedang mengambil item farm.
              </StatePanel>
            )}
            {error && (
              <StatePanel
                kind="error"
                title="Persediaan belum dapat dimuat"
                onRetry={() => setRevision((value) => value + 1)}
              >
                {error}
              </StatePanel>
            )}
            {!error && (
              <Card title="Katalog item" className="inventory-list-card">
                <p className="list-meta">
                  Satuan dasar mengikuti item. Stok masuk dan keluar dicatat
                  pada lot.
                </p>
                <DataTable
                  caption="Item persediaan farm"
                  rows={items}
                  rowKey={(item) => item.id}
                  emptyMessage="Belum ada item. Tambahkan item pertama melalui formulir."
                  columns={[
                    {
                      key: "name",
                      label: "Item",
                      render: (item) => (
                        <span>
                          <strong>{item.name}</strong>
                          <small className="schedule-cell-meta">
                            {categoryLabels[item.category]} ·{" "}
                            {item.active ? "Aktif" : "Nonaktif"}
                          </small>
                        </span>
                      ),
                    },
                    {
                      key: "quantity",
                      label: "Saldo",
                      render: (item) => (
                        <strong>
                          {formatDecimal(item.quantity)} {unitLabels[item.unit]}
                        </strong>
                      ),
                    },
                    {
                      key: "minimum",
                      label: "Minimum",
                      render: (item) => (
                        <span>
                          {formatDecimal(item.minimumStock)}{" "}
                          {unitLabels[item.unit]}
                        </span>
                      ),
                    },
                    {
                      key: "lots",
                      label: "Lot",
                      render: (item) => item.lotCount,
                    },
                    {
                      key: "action",
                      label: "",
                      render: (item) => (
                        <Link to={`/inventory/${item.id}`}>Detail →</Link>
                      ),
                    },
                  ]}
                />
                {nextOffset !== null && (
                  <button
                    type="button"
                    className="inventory-more"
                    disabled={loading}
                    onClick={() => setOffset(nextOffset)}
                  >
                    {loading ? "Memuat…" : "Muat item berikutnya"}
                  </button>
                )}
              </Card>
            )}
          </div>
          <Card title="Buat item" className="form-card inventory-form-card">
            <p>
              Item baru dimulai dengan saldo 0. Tambahkan lot untuk menyiapkan
              identitas stok.
            </p>
            <form onSubmit={(event) => void create(event)}>
              <FormField id="inventory-name" label="Nama item">
                <input
                  id="inventory-name"
                  required
                  maxLength={120}
                  value={draft.name}
                  onChange={(event) => change("name", event.target.value)}
                />
              </FormField>
              <FormField id="inventory-category" label="Kategori">
                <select
                  id="inventory-category"
                  value={draft.category}
                  onChange={(event) =>
                    change(
                      "category",
                      event.target.value as ItemDraft["category"],
                    )
                  }
                >
                  {inventoryCategories.map((category) => (
                    <option key={category} value={category}>
                      {categoryLabels[category]}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="inventory-unit" label="Satuan dasar">
                <select
                  id="inventory-unit"
                  value={draft.unit}
                  onChange={(event) =>
                    change("unit", event.target.value as ItemDraft["unit"])
                  }
                >
                  {units.map((unit) => (
                    <option key={unit} value={unit}>
                      {unitLabels[unit]}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField
                id="inventory-minimum"
                label={`Stok minimum (${unitLabels[draft.unit]})`}
              >
                <input
                  id="inventory-minimum"
                  type="number"
                  min="0"
                  step={
                    ["UNIT", "HEAD", "SEED"].includes(draft.unit)
                      ? "1"
                      : "0.001"
                  }
                  required
                  value={draft.minimumStock}
                  onChange={(event) =>
                    change("minimumStock", event.target.value)
                  }
                />
              </FormField>
              <button type="submit" disabled={pending}>
                Buat item
              </button>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}

export function InventoryItemPage({
  state,
}: {
  state: ReturnType<typeof useFarms>;
}) {
  const farmId = state.activeId;
  const { itemId } = useParams();
  const [item, setItem] = useState<InventoryItemSummary | null>(null);
  const [lots, setLots] = useState<InventoryLotSummary[]>([]);
  const [draft, setDraft] = useState<ItemDraft>(blankItem);
  const [lotDraft, setLotDraft] = useState<LotDraft>(blankLot);
  const [editingLotId, setEditingLotId] = useState<string | null>(null);
  const [editKey, setEditKey] = useState(() => crypto.randomUUID());
  const [lotKey, setLotKey] = useState(() => crypto.randomUUID());
  const [toggleKey, setToggleKey] = useState(() => crypto.randomUUID());
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!farmId || !itemId || state.loading) {
      setItem(null);
      setLots([]);
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      request<InventoryItemSummary>(`/api/farms/${farmId}/items/${itemId}`),
      request<InventoryLotSummary[]>(
        `/api/farms/${farmId}/items/${itemId}/lots`,
      ),
    ])
      .then(([loadedItem, loadedLots]) => {
        if (!current) return;
        setItem(loadedItem);
        setLots(loadedLots);
        setDraft({
          name: loadedItem.name,
          category: loadedItem.category,
          unit: loadedItem.unit,
          minimumStock: loadedItem.minimumStock,
        });
      })
      .catch((cause) => {
        if (current)
          setLoadError(
            cause instanceof Error ? cause.message : "Gagal memuat item.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [farmId, itemId, state.loading, revision]);
  function changeItem<K extends keyof ItemDraft>(
    field: K,
    value: ItemDraft[K],
  ) {
    setDraft((current) => ({ ...current, [field]: value }));
    setEditKey(crypto.randomUUID());
  }
  function changeLot<K extends keyof LotDraft>(field: K, value: LotDraft[K]) {
    setLotDraft((current) => ({ ...current, [field]: value }));
    setLotKey(crypto.randomUUID());
  }
  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farmId || !itemId || !item || pending) return;
    setPending(true);
    setActionError(null);
    setMessage(null);
    try {
      const updated = await request<InventoryItemSummary>(
        `/api/farms/${farmId}/items/${itemId}`,
        "PATCH",
        { idempotencyKey: editKey, ...draft, active: item.active },
      );
      setItem(updated);
      setEditKey(crypto.randomUUID());
      setMessage("Perubahan item tersimpan.");
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Gagal menyimpan item.",
      );
    } finally {
      setPending(false);
    }
  }
  async function toggleActive() {
    if (!farmId || !itemId || !item || pending) return;
    setPending(true);
    setActionError(null);
    setMessage(null);
    try {
      const updated = await request<InventoryItemSummary>(
        `/api/farms/${farmId}/items/${itemId}`,
        "PATCH",
        {
          idempotencyKey: toggleKey,
          name: item.name,
          category: item.category,
          unit: item.unit,
          minimumStock: item.minimumStock,
          active: !item.active,
        },
      );
      setItem(updated);
      setToggleKey(crypto.randomUUID());
      setConfirmDeactivate(false);
      setMessage(
        updated.active ? "Item diaktifkan kembali." : "Item dinonaktifkan.",
      );
    } catch (cause) {
      setConfirmDeactivate(false);
      setActionError(
        cause instanceof Error ? cause.message : "Gagal mengubah status item.",
      );
    } finally {
      setPending(false);
    }
  }
  function editLot(lot: InventoryLotSummary) {
    setEditingLotId(lot.id);
    setLotDraft({
      label: lot.label,
      location: lot.location ?? "",
      expiresOn: lot.expiresOn ?? "",
    });
    setLotKey(crypto.randomUUID());
    setActionError(null);
  }
  function resetLot() {
    setEditingLotId(null);
    setLotDraft(blankLot());
    setLotKey(crypto.randomUUID());
  }
  async function saveLot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farmId || !itemId || !item || pending) return;
    setPending(true);
    setActionError(null);
    setMessage(null);
    try {
      if (editingLotId) {
        const updated = await request<InventoryLotSummary>(
          `/api/farms/${farmId}/lots/${editingLotId}`,
          "PATCH",
          {
            idempotencyKey: lotKey,
            label: lotDraft.label,
            location: lotDraft.location || null,
            expiresOn: lotDraft.expiresOn || null,
          },
        );
        setLots((current) =>
          current.map((lot) => (lot.id === updated.id ? updated : lot)),
        );
        setMessage("Perubahan lot tersimpan.");
      } else {
        const created = await request<InventoryLotSummary>(
          `/api/farms/${farmId}/lots`,
          "POST",
          {
            idempotencyKey: lotKey,
            inventoryItemId: itemId,
            label: lotDraft.label,
            location: lotDraft.location || undefined,
            expiresOn: lotDraft.expiresOn || undefined,
          },
        );
        setLots((current) => [...current, created]);
        setItem((current) =>
          current ? { ...current, lotCount: current.lotCount + 1 } : current,
        );
        setMessage("Lot berhasil dibuat dengan saldo 0.");
      }
      resetLot();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Gagal menyimpan lot.",
      );
    } finally {
      setPending(false);
    }
  }
  async function refreshBalances() {
    if (!farmId || !itemId) return;
    const [updatedItem, updatedLots] = await Promise.all([
      request<InventoryItemSummary>(`/api/farms/${farmId}/items/${itemId}`),
      request<InventoryLotSummary[]>(
        `/api/farms/${farmId}/items/${itemId}/lots`,
      ),
    ]);
    setItem(updatedItem);
    setLots(updatedLots);
  }
  return (
    <>
      <PageHeader
        eyebrow="Operasional / Persediaan"
        title={item?.name ?? "Detail item"}
        description="Lihat saldo dari ledger, ubah identitas item, dan kelola lot yang terkait."
        visual="farm"
      />
      <Link className="back-link" to="/inventory">
        ← Kembali ke persediaan
      </Link>
      {!state.loading && !farmId && (
        <StatePanel kind="empty" title="Belum ada farm aktif">
          Pilih farm terlebih dahulu.
        </StatePanel>
      )}
      {loading && (
        <StatePanel kind="loading" title="Memuat item">
          Sedang mengambil item dan lot.
        </StatePanel>
      )}
      {loadError && (
        <StatePanel
          kind="error"
          title="Item belum dapat dimuat"
          onRetry={() => setRevision((value) => value + 1)}
        >
          {loadError}
        </StatePanel>
      )}
      {message && (
        <StatePanel kind="success" title="Tersimpan">
          {message}
        </StatePanel>
      )}
      {actionError && (
        <StatePanel kind="error" title="Perubahan belum tersimpan">
          {actionError}
        </StatePanel>
      )}
      {item && !loading && (
        <>
          <div className="registry-summary" aria-label="Ringkasan item">
            <span>
              Saldo{" "}
              <strong>
                {formatDecimal(item.quantity)} {unitLabels[item.unit]}
              </strong>
            </span>
            <span>
              Minimum{" "}
              <strong>
                {formatDecimal(item.minimumStock)} {unitLabels[item.unit]}
              </strong>
            </span>
            <span>
              <strong>{item.lotCount}</strong> lot
            </span>
            <span>
              <strong>{item.active ? "Aktif" : "Nonaktif"}</strong>
            </span>
          </div>
          <div className="inventory-grid">
            <div className="inventory-main">
              <Card title="Lot item" className="inventory-list-card">
                <p className="list-meta">
                  Membuat lot tidak menambah stok. Saldo berubah hanya melalui
                  pergerakan yang tercatat.
                </p>
                <DataTable
                  caption="Lot pada item ini"
                  rows={lots}
                  rowKey={(lot) => lot.id}
                  emptyMessage="Belum ada lot untuk item ini."
                  columns={[
                    {
                      key: "label",
                      label: "Lot",
                      render: (lot) => (
                        <span>
                          <strong>{lot.label}</strong>
                          <small className="schedule-cell-meta">
                            {lot.location ?? "Lokasi belum dicatat"}
                          </small>
                        </span>
                      ),
                    },
                    {
                      key: "expires",
                      label: "Kedaluwarsa",
                      render: (lot) => lot.expiresOn ?? "—",
                    },
                    {
                      key: "balance",
                      label: "Saldo",
                      render: (lot) => (
                        <strong>
                          {formatDecimal(lot.quantity)} {unitLabels[item.unit]}
                        </strong>
                      ),
                    },
                    {
                      key: "action",
                      label: "",
                      render: (lot) => (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => editLot(lot)}
                        >
                          Ubah
                        </button>
                      ),
                    },
                  ]}
                />
              </Card>
              <Card title="Ubah item" className="form-card">
                <p>
                  Satuan dasar dapat diubah hanya sebelum ada pergerakan stok.
                  Item dengan saldo atau produk aktif tidak dapat dinonaktifkan.
                </p>
                <form onSubmit={(event) => void saveItem(event)}>
                  <div className="inventory-fields">
                    <FormField id="item-edit-name" label="Nama item">
                      <input
                        id="item-edit-name"
                        required
                        maxLength={120}
                        value={draft.name}
                        onChange={(event) =>
                          changeItem("name", event.target.value)
                        }
                      />
                    </FormField>
                    <FormField id="item-edit-category" label="Kategori">
                      <select
                        id="item-edit-category"
                        value={draft.category}
                        onChange={(event) =>
                          changeItem(
                            "category",
                            event.target.value as ItemDraft["category"],
                          )
                        }
                      >
                        {inventoryCategories.map((category) => (
                          <option key={category} value={category}>
                            {categoryLabels[category]}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <FormField id="item-edit-unit" label="Satuan dasar">
                      <select
                        id="item-edit-unit"
                        value={draft.unit}
                        onChange={(event) =>
                          changeItem(
                            "unit",
                            event.target.value as ItemDraft["unit"],
                          )
                        }
                      >
                        {units.map((unit) => (
                          <option key={unit} value={unit}>
                            {unitLabels[unit]}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <FormField id="item-edit-minimum" label="Stok minimum">
                      <input
                        id="item-edit-minimum"
                        type="number"
                        min="0"
                        step={
                          ["UNIT", "HEAD", "SEED"].includes(draft.unit)
                            ? "1"
                            : "0.001"
                        }
                        required
                        value={draft.minimumStock}
                        onChange={(event) =>
                          changeItem("minimumStock", event.target.value)
                        }
                      />
                    </FormField>
                  </div>
                  <div className="actions">
                    <button
                      type="button"
                      className={item.active ? "button-danger-text" : ""}
                      disabled={pending}
                      onClick={() =>
                        item.active
                          ? setConfirmDeactivate(true)
                          : void toggleActive()
                      }
                    >
                      {item.active ? "Nonaktifkan" : "Aktifkan kembali"}
                    </button>
                    <button type="submit" disabled={pending}>
                      Simpan item
                    </button>
                  </div>
                </form>
              </Card>
            </div>
            <Card
              title={editingLotId ? "Ubah lot" : "Buat lot"}
              className="form-card inventory-form-card"
            >
              <p>Catat label, lokasi, dan tanggal kedaluwarsa lot.</p>
              <form onSubmit={(event) => void saveLot(event)}>
                <FormField id="lot-label" label="Label lot">
                  <input
                    id="lot-label"
                    required
                    maxLength={120}
                    value={lotDraft.label}
                    onChange={(event) => changeLot("label", event.target.value)}
                  />
                </FormField>
                <FormField id="lot-location" label="Lokasi (opsional)">
                  <input
                    id="lot-location"
                    maxLength={500}
                    value={lotDraft.location}
                    onChange={(event) =>
                      changeLot("location", event.target.value)
                    }
                  />
                </FormField>
                <FormField
                  id="lot-expires"
                  label="Tanggal kedaluwarsa (opsional)"
                >
                  <input
                    id="lot-expires"
                    type="date"
                    value={lotDraft.expiresOn}
                    onChange={(event) =>
                      changeLot("expiresOn", event.target.value)
                    }
                  />
                </FormField>
                <div className="actions">
                  {editingLotId && (
                    <button type="button" onClick={resetLot}>
                      Batal edit
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={pending || (!item.active && !editingLotId)}
                  >
                    {editingLotId ? "Simpan lot" : "Buat lot"}
                  </button>
                </div>
              </form>
            </Card>
          </div>
          {farmId && (
            <InventoryMovements
              farmId={farmId}
              item={item}
              lots={lots}
              onChanged={refreshBalances}
            />
          )}
        </>
      )}
      <ConfirmDialog
        open={confirmDeactivate}
        title="Nonaktifkan item?"
        onClose={() => setConfirmDeactivate(false)}
        onConfirm={() => void toggleActive()}
      >
        Item tidak dapat dinonaktifkan bila masih memiliki saldo atau digunakan
        produk aktif.
      </ConfirmDialog>
    </>
  );
}
