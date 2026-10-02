import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { FarmMemberSummary } from "../modules/farms/contracts.js";
import {
  Card,
  ConfirmDialog,
  DataTable,
  FormField,
  PageHeader,
  StatePanel,
} from "./components/primitives.js";
import { request, useFarms } from "./farms.js";

type FarmMembers = {
  members: FarmMemberSummary[];
  canManageMembers: boolean;
};

export function FarmMembersPage({
  state,
}: {
  state: ReturnType<typeof useFarms>;
}) {
  const farmId = state.activeId;
  const activeFarm = state.farms.find((farm) => farm.id === farmId);
  const [data, setData] = useState<FarmMembers | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<FarmMemberSummary | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removeKeys, setRemoveKeys] = useState<Record<string, string>>({});
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );

  const reload = useCallback(async () => {
    if (!farmId) return;
    setLoading(true);
    try {
      setData(await request<FarmMembers>(`/api/farms/${farmId}/members`));
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Gagal memuat anggota.",
      );
    } finally {
      setLoading(false);
    }
  }, [farmId]);

  useEffect(() => {
    setData(null);
    setEmail("");
    setActionError(null);
    setMessage(null);
    setRemoving(null);
    setRemoveError(null);
    setRemoveKeys({});
    void reload();
  }, [reload]);

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farmId || pending) return;
    setPending(true);
    setActionError(null);
    setMessage(null);
    try {
      await request(`/api/farms/${farmId}/members`, "POST", {
        idempotencyKey,
        email,
      });
      setEmail("");
      setIdempotencyKey(crypto.randomUUID());
      setMessage("Anggota berhasil ditambahkan.");
      await reload();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Anggota gagal ditambahkan.",
      );
    } finally {
      setPending(false);
    }
  }

  async function removeMember() {
    if (!farmId || !removing || pending) return;
    const member = removing;
    const idempotencyKey = removeKeys[member.id] ?? crypto.randomUUID();
    setRemoveKeys((previous) => ({
      ...previous,
      [member.id]: idempotencyKey,
    }));
    setPending(true);
    setRemoveError(null);
    setMessage(null);
    try {
      await request(`/api/farms/${farmId}/members/${member.id}`, "DELETE", {
        idempotencyKey,
      });
      setRemoving(null);
      setRemoveKeys((previous) => ({
        ...previous,
        [member.id]: crypto.randomUUID(),
      }));
      setMessage(`${member.displayName} dikeluarkan dari farm.`);
      await reload();
    } catch (cause) {
      setRemoveError(
        cause instanceof Error ? cause.message : "Anggota gagal dikeluarkan.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Farm"
        title="Anggota farm"
        description="Kelola siapa saja yang dapat bekerja di farm aktif."
        visual="farm"
      />
      {!activeFarm ? (
        <StatePanel kind="empty" title="Pilih farm terlebih dahulu">
          Pilih atau buat farm di <Link to="/farms">Kelola Farm</Link>.
        </StatePanel>
      ) : loading && !data ? (
        <StatePanel kind="loading" title="Memuat anggota" />
      ) : error ? (
        <StatePanel
          kind="error"
          title="Anggota belum dapat dimuat"
          onRetry={() => void reload()}
        >
          {error}
        </StatePanel>
      ) : data ? (
        <div className="farm-member-layout">
          {data.canManageMembers && (
            <Card title="Tambahkan anggota" className="form-card">
              <p>
                Akun OpSmart harus sudah terdaftar. Semua anggota mendapat akses
                operasional dan keuangan yang sama.
              </p>
              <form onSubmit={addMember}>
                <FormField id="member-email" label="Email akun OpSmart">
                  <input
                    id="member-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </FormField>
                {actionError && <p role="alert">{actionError}</p>}
                <button type="submit" disabled={pending || !email.trim()}>
                  {pending ? "Menambahkan…" : "Tambahkan anggota"}
                </button>
              </form>
            </Card>
          )}
          <Card
            title={`${data.members.length} anggota`}
            className="member-list-card"
          >
            <p className="list-meta">
              Owner mengelola anggota. Hak kerja semua anggota setara.
            </p>
            {message && <p role="status">{message}</p>}
            <DataTable
              caption={`Anggota ${activeFarm.name}`}
              rows={data.members}
              rowKey={(member) => member.id}
              emptyMessage="Belum ada anggota yang terdaftar."
              columns={[
                {
                  key: "member",
                  label: "Anggota",
                  render: (member) => (
                    <span className="farm-member-name">
                      <strong>{member.displayName}</strong>
                      {member.email && <small>{member.email}</small>}
                    </span>
                  ),
                },
                {
                  key: "access",
                  label: "Akses",
                  render: (member) =>
                    member.isOwner
                      ? "Owner · kelola anggota"
                      : "Operasional + keuangan",
                },
                {
                  key: "actions",
                  label: "Aksi",
                  render: (member) =>
                    data.canManageMembers && !member.isOwner ? (
                      <button
                        type="button"
                        className="button-danger-text"
                        disabled={pending}
                        onClick={() => {
                          setRemoveError(null);
                          setRemoving(member);
                        }}
                      >
                        Keluarkan {member.displayName}
                      </button>
                    ) : null,
                },
              ]}
            />
          </Card>
        </div>
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        title="Keluarkan anggota dari farm?"
        onClose={() => {
          setRemoving(null);
          setRemoveError(null);
        }}
        onConfirm={() => void removeMember()}
        busy={pending}
      >
        {removeError && <p role="alert">{removeError}</p>}
        {removing?.displayName} tidak dapat mengakses farm aktif setelah
        dikeluarkan. Catatan operasional dan actor lama tetap tersimpan.
      </ConfirmDialog>
    </>
  );
}
