import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, PageHeader } from "./components/primitives.js";
import { Icon, type IconName } from "./icons.js";
import "./education.css";

const sections = [
  { value: "ask", label: "Tanya AI", icon: "message" },
  { value: "knowledge", label: "Kelola Knowledge", icon: "book" },
  { value: "api", label: "Kelola API", icon: "key" },
] as const;
const prompts = [
  {
    label: "Perawatan kolam",
    question: "SOP perawatan kolam apa yang perlu saya ikuti?",
  },
  {
    label: "Sanitasi kandang",
    question: "Apa panduan sanitasi kandang yang tersedia?",
  },
  {
    label: "Penyiraman tanaman",
    question: "Bagaimana SOP penyiraman area tanam?",
  },
];

function EmptyKnowledge({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`education-empty ${compact ? "is-compact" : ""}`}>
      <span className="education-empty-icon">
        <Icon name="book" size={compact ? 25 : 34} />
      </span>
      <h3>
        {compact ? "Belum ada sumber terhubung" : "Knowledge belum terhubung"}
      </h3>
      <p>
        {compact
          ? "Dokumen dan bagian yang mendukung jawaban akan ditampilkan di sini setelah asisten aktif."
          : "Unggah, pencarian, dan pengelolaan dokumen belum tersedia. Siapkan SOP internal yang Anda miliki atau punya izin untuk digunakan."}
      </p>
    </div>
  );
}

function SetupLink({
  view,
  icon,
  title,
  children,
}: {
  view: string;
  icon: IconName;
  title: string;
  children: string;
}) {
  return (
    <Link className="education-setup-link" to={`/education?view=${view}`}>
      <Icon name={icon} size={22} />
      <span>
        <strong>{title}</strong>
        <small>{children}</small>
      </span>
    </Link>
  );
}

export function EducationPage() {
  const [params] = useSearchParams();
  const section =
    sections.find((item) => item.value === params.get("view"))?.value ?? "ask";
  const [question, setQuestion] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="education-page">
      <PageHeader
        eyebrow="Pengetahuan JagoFarm"
        title="Education"
        description="SOP dan panduan budidaya untuk pekerjaan farm."
        visual="education"
      />
      <div className="education-availability" role="status">
        <Icon name="book" size={22} />
        <div>
          <strong>Asisten edukasi belum aktif</strong>
          <p>
            Dokumen knowledge dan layanan AI belum terhubung. Jawaban bersumber
            belum tersedia.
          </p>
        </div>
      </div>
      <nav className="education-nav" aria-label="Bagian Education">
        {sections.map((item) => (
          <Link
            key={item.value}
            to={`/education?view=${item.value}`}
            aria-current={section === item.value ? "page" : undefined}
          >
            <Icon name={item.icon} size={18} />
            {item.label}
          </Link>
        ))}
      </nav>

      {section === "ask" && (
        <div className="education-workspace">
          <Card title="Tanya tentang pekerjaan farm" className="education-chat">
            <div className="education-welcome">
              <span className="education-empty-icon">
                <Icon name="message" size={32} />
              </span>
              <h3>Mulai dari SOP yang tepercaya</h3>
              <p>
                Tanyakan SOP ikan, ayam, atau tanaman. Jawaban akan menyertakan
                sumber yang disetujui.
              </p>
            </div>
            <div className="education-prompts">
              <p>Contoh pertanyaan</p>
              {prompts.map((prompt) => (
                <button
                  key={prompt.label}
                  type="button"
                  aria-label={prompt.question}
                  onClick={() => {
                    setQuestion(prompt.question);
                    input.current?.focus();
                  }}
                >
                  {prompt.label}
                </button>
              ))}
            </div>
            <form
              className="education-composer"
              onSubmit={(event) => event.preventDefault()}
            >
              <label htmlFor="education-question">Pertanyaan Anda</label>
              <textarea
                ref={input}
                id="education-question"
                rows={3}
                maxLength={2000}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Tulis pertanyaan tentang SOP atau panduan budidaya…"
                aria-describedby="education-question-help"
              />
              <div className="education-composer-footer">
                <p id="education-question-help">
                  Pertanyaan belum dapat dikirim karena asisten belum aktif.
                </p>
                <button
                  type="submit"
                  disabled
                  aria-describedby="education-question-help"
                >
                  Kirim pertanyaan
                </button>
              </div>
            </form>
          </Card>
          <aside
            className="education-side"
            aria-label="Sumber dan persiapan asisten"
          >
            <Card title="Sumber jawaban">
              <EmptyKnowledge compact />
            </Card>
            <Card title="Persiapan Education" className="education-setup">
              <SetupLink view="knowledge" icon="book" title="Siapkan knowledge">
                Tinjau dokumen dan izin penggunaannya.
              </SetupLink>
              <SetupLink view="api" icon="key" title="Tinjau koneksi API">
                Lihat kebutuhan provider dan model AI.
              </SetupLink>
            </Card>
          </aside>
        </div>
      )}

      {section === "knowledge" && (
        <div className="education-workspace">
          <Card title="Dokumen knowledge" className="education-library">
            <p>SOP dan panduan yang menjadi rujukan asisten edukasi.</p>
            <EmptyKnowledge />
            <p className="education-footnote">
              Pengunggahan dokumen belum diaktifkan. Belum ada materi yang dapat
              digunakan untuk menjawab pertanyaan.
            </p>
          </Card>
          <aside className="education-side" aria-label="Persiapan dokumen">
            <Card title="Siapkan informasi dokumen">
              <dl className="education-requirements">
                <dt>Judul dan versi</dt>
                <dd>Nama SOP, versi, serta tanggal berlakunya.</dd>
                <dt>Pemilik dan izin</dt>
                <dd>Penanggung jawab dokumen dan izin penggunaannya.</dd>
                <dt>Kesesuaian budidaya</dt>
                <dd>
                  Jenis ikan, ayam, atau tanaman serta sistem yang dibahas.
                </dd>
                <dt>Pembaca dan masa berlaku</dt>
                <dd>
                  Siapa yang boleh mengakses dan kapan materi perlu ditinjau
                  kembali.
                </dd>
              </dl>
            </Card>
            <p className="education-side-note">
              Gunakan dokumen yang masih berlaku dan sesuai dengan kegiatan
              farm.
            </p>
          </aside>
        </div>
      )}

      {section === "api" && (
        <div className="education-workspace">
          <Card title="Koneksi layanan AI" className="education-connections">
            <p>Layanan jawaban dan pencarian dokumen belum dikonfigurasi.</p>
            <dl className="education-connection-list">
              <div>
                <dt>Provider AI</dt>
                <dd>Belum terhubung</dd>
              </div>
              <div>
                <dt>Model jawaban</dt>
                <dd>Belum dipilih</dd>
              </div>
              <div>
                <dt>Model pencarian dokumen</dt>
                <dd>Belum dipilih</dd>
              </div>
              <div>
                <dt>Pengaturan API key</dt>
                <dd>Belum tersedia</dd>
              </div>
            </dl>
            <div className="education-connection-note">
              <Icon name="key" size={22} />
              <p>
                Pengaturan koneksi belum tersedia. Halaman ini tidak menerima
                atau menyimpan API key.
              </p>
            </div>
          </Card>
          <aside className="education-side" aria-label="Kebutuhan koneksi API">
            <Card title="Sebelum menghubungkan API">
              <ul className="education-checklist">
                <li>
                  Tentukan provider dan model untuk jawaban serta pencarian
                  dokumen.
                </li>
                <li>
                  Pastikan dokumen diizinkan untuk diproses oleh provider
                  tersebut.
                </li>
                <li>Tetapkan batas biaya dan kebijakan penyimpanan data.</li>
              </ul>
            </Card>
            <p className="education-side-note">
              Asisten memerlukan knowledge dan koneksi AI agar dapat memberikan
              jawaban bersumber.
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}
