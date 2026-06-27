import { ref, set, onValue, update, remove, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { db, auth } from "./js/firebase-init.js";
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { hashPIN, registerStaff } from "./js/role-manager.js";
import "./js/audit.js";
import "./js/security.js";
import "./js/shortcuts.js";
import "./js/hold-bill.js";

let keranjang = [];
window.getKeranjang = () => keranjang;
window.setKeranjang = (k) => { keranjang = k; };
let editIndex = -1;
let listProduk = [];

let currentSortField = "notaId";
let currentSortDirection = "desc";
let currentProdukSort = null;
let currentProdukDirection = "asc";
let produkTerpilih = null;
let kategoriAktif = "SEMUA";
let kataKunciProduk = "";
let masterOrdersCache = {};
let databasePelangganLokal = {};

// ========================================================
// 💰 UI/UX PREMIUM: TOMBOL INSTAN NOMINAL UANG PAS
// ========================================================
window.setNominalInstan = function (nominal) {
    const inputBayar = document.getElementById("payment-dp");
    const totalTagihanText = document.getElementById("cart-total")?.innerText || "Rp 0";

    // Konversi teks Rp total belanja menjadi angka murni
    let totalTagihanAngka = parseInt(totalTagihanText.replace(/[^0-9]/g, "")) || 0;

    if (inputBayar) {
        if (nominal === 'pas') {
            inputBayar.value = totalTagihanAngka;
        } else {
            inputBayar.value = nominal;
        }

        // Pemicu otomatis agar sisa tagihan langsung dihitung live oleh sistem bawaanmu
        if (typeof hitungSisaTagihan === "function") {
            window.hitungSisaTagihan();
        }
    }
};

window.onload = function () {
    // Expose local functions to window for modules like hold-bill.js
    window.renderKeranjangGlobal = renderKeranjang;
    window.hapusDraftOtomatisGlobal = hapusDraftOtomatis;
    window.simpanDraftOtomatisGlobal = simpanDraftOtomatis;

    // Kunci pengisian tanggal hari ini ke semua kalender sistem
    const hariIni = new Date().toISOString().split('T')[0];

    // Kalender Tab Laporan
    if (document.getElementById("report-start-date")) document.getElementById("report-start-date").value = hariIni;
    if (document.getElementById("report-end-date")) document.getElementById("report-end-date").value = hariIni;

    // Kalender Tab Dashboard (Baru)
    if (document.getElementById("db-start-date")) document.getElementById("db-start-date").value = hariIni;
    if (document.getElementById("db-end-date")) document.getElementById("db-end-date").value = hariIni;

    listenProdukCloud();
    listenDataCloud();
    listenDatabasePelanggan();
    loadPengaturanSistem();
    loadDraftOtomatis();
    initEventListeners();
};

function initEventListeners() {
    // SEARCH PRODUK ADMIN
    document.getElementById("search-produk-admin")?.addEventListener("input", renderTabelAdminProduk);

    // SEARCH ORDER
    document.getElementById("search-order-dynamic")?.addEventListener("input", renderTableAntrean);

    // FILTER TANGGAL
    document.getElementById("filter-tanggal-order")?.addEventListener("change", renderTableAntrean);

    // FILTER STATUS
    document.getElementById("filter-status-order")?.addEventListener("change", renderTableAntrean);
    // 💰 PEMANTAU DROPDOWN PEMBAYARAN (Wajib ditambahkan agar filter keuangan berfungsi!)
    document.getElementById("filter-pembayaran-order")?.addEventListener("change", renderTableAntrean);
    // Pemantau ketikan nama pelanggan
    document.getElementById("cust-name")?.addEventListener("input", function () {
        updateBadgeStatusKasir(this.value.trim());
    });

    // 🎯 SINKRONISASI FILTER OTOMATIS LAPORAN (Ditaruh di sini agar aman dan rapi!)
    document.getElementById("report-start-date")?.addEventListener("change", hitungDataDashboardDanLaporan);
    document.getElementById("report-end-date")?.addEventListener("change", hitungDataDashboardDanLaporan);
    // Otomatis merespons dan menggambar ulang grafik saat kalender dashboard diubah
    document.getElementById("db-start-date")?.addEventListener("change", hitungDataDashboardDanLaporan);
    document.getElementById("db-end-date")?.addEventListener("change", hitungDataDashboardDanLaporan);
    // Event listener untuk pencarian dan reset di menu Pelanggan
    document.getElementById("search-pelanggan-input")?.addEventListener("input", renderTablePelanggan);
    document.getElementById("btn-reset-pelanggan")?.addEventListener("click", function () {
        const inp = document.getElementById("search-pelanggan-input");
        if (inp) inp.value = "";
        renderTablePelanggan();
    });
}

window.resetFilterOrder = function () {

    document.getElementById(
        'search-order-dynamic'
    ).value = '';

    document.getElementById(
        'filter-status-order'
    ).value = '';

    if (document.getElementById('filter-pembayaran-order')) {
        document.getElementById('filter-pembayaran-order').value = ''; // <-- KUNCI BARU 3
    }

    const today = new Date();

    const yyyy =
        today.getFullYear();

    const mm =
        String(
            today.getMonth() + 1
        ).padStart(2, '0');

    const dd =
        String(
            today.getDate()
        ).padStart(2, '0');

    document.getElementById(
        'filter-tanggal-order'
    ).value =
        `${yyyy}-${mm}-${dd}`;

    // FORCE RENDER ULANG

    setTimeout(() => {

        renderTableAntrean();

    }, 10);

}

// ========================================================
// 🎯 MODUL PREMIUM: SIMPAN KEBIJAKAN SISTEM KE FIREBASE CLOUD
// ========================================================
window.simpanKebijakanSistemCloud = function () {
    if (window.currentUserRole !== 'owner') {
        Swal.fire('Akses Ditolak', 'Hanya Owner yang dapat mengubah Kebijakan Sistem Operasional.', 'error');
        return;
    }
    const dataKebijakan = {
        tarifPotong: parseInt(document.getElementById("set-tarif-potong").value) || 125,
        metodePembulatan: parseInt(document.getElementById("set-pembulatan").value),
        hariVakum: parseInt(document.getElementById("set-hari-vakum").value) || 14,
        minOrderLoyal: parseInt(document.getElementById("set-min-loyal").value) || 5
    };

    set(ref(db, 'settings/system_policy'), dataKebijakan)
        .then(() => {
            showNotification("Kebijakan Operasional Berhasil Diperbarui!", "primary");
            // Paksa sistem hitung ulang dashboard & pelanggan agar langsung menggunakan aturan baru
            if (typeof hitungDataDashboardDanLaporan === "function") hitungDataDashboardDanLaporan();
            if (typeof renderTablePelanggan === "function") renderTablePelanggan();
        })
        .catch(() => {
            showNotification("Gagal memperbarui kebijakan sistem.", "danger");
        });
};

function lakukanPembulatanKasir(nominal) {
    const kelipatan = kebijakanSistemLokal.metodePembulatan !== undefined ? kebijakanSistemLokal.metodePembulatan : 500;
    if (kelipatan === 0) return nominal; // Tanpa pembulatan
    return Math.ceil(nominal / kelipatan) * kelipatan;
}

function listenProdukCloud() {
    onValue(ref(db, 'catalog_products'), (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        listProduk = Object.keys(data).map(key => data[key]);
        renderKatalog();
        renderTabelAdminProduk();
    });
}

function ambilHargaGrosirSistem(produkNama, qty) {
    let namaLow = produkNama.toLowerCase().trim();

    // Cari data produk asli yang cocok dari list master produk Firebase
    let match = listProduk.find(p => p.nama.toLowerCase().trim() === namaLow);
    if (!match) return 0;

    let hargaNormal = parseInt(match.harga) || 0;
    let minQtyGrosir = parseInt(match.grosirQty) || 0;
    let hargaGrosirCloud = parseInt(match.grosirHarga) || 0;

    // 🧠 LOGIKA PINTAR: Jika admin menyetel grosir (minQty > 0) dan jumlah belanja kasir memenuhi syarat
    if (minQtyGrosir > 0 && qty >= minQtyGrosir && hargaGrosirCloud > 0) {
        return hargaGrosirCloud; // Berikan harga grosir otomatis murah dari Firebase!
    }

    return hargaNormal; // Jika tidak memenuhi syarat, berikan harga eceran biasa
}

function badgeClassOrder(status) {

    if (status === "PENDING")
        return "b-pending";

    if (status === "PROSES")
        return "b-desain";

    if (status === "SELESAI")
        return "b-selesai";

    if (status === "CANCEL")
        return "bg-danger";

    return "bg-secondary";
}

window.sortTableProduk = function (field) {

    if (currentProdukSort === field) {

        currentProdukDirection =
            currentProdukDirection === "asc"
                ? "desc"
                : "asc";

    } else {

        currentProdukSort = field;
        currentProdukDirection = "asc";
    }

    renderTabelAdminProduk();
    window.updateSortIcons('produk-table-head', currentProdukSort, currentProdukDirection);
}

window.sortTableOrder = function (field) {

    if (currentSortField === field) {

        currentSortDirection =
            currentSortDirection === "asc"
                ? "desc"
                : "asc";

    } else {

        currentSortField = field;
        currentSortDirection = "asc";
    }

    renderTableAntrean();
    window.updateSortIcons('order-table-head', currentSortField, currentSortDirection);
}

function renderTableAntrean() {
    const tbody = document.getElementById("table-antrean");
    if (!tbody) return;

    tbody.innerHTML = "";

    let dataOrder = Object.values(masterOrdersCache || {});

    // FILTER KEYWORD & STATUS
    const keyword = (document.getElementById("search-order-dynamic")?.value || "").toLowerCase();
    const filterStatus = document.getElementById("filter-status-order")?.value || "";
    const filterBayar = document.getElementById("filter-pembayaran-order")?.value || "";

    // 📆 MEMBACA INPUT DUA KALENDER BARU
    let tglMulai = document.getElementById("filter-tanggal-mulai")?.value || "";
    let tglSelesai = document.getElementById("filter-tanggal-selesai")?.value || "";

    // 🧠 LOGIKA PINTAR KASIR: JIKA KEDUANYA KOSONG (SAAT BARU KLIK MENU), PAKSA KUNCI KE HARI INI
    if (!tglMulai && !tglSelesai) {
        let today = new Date();
        let yyyy = today.getFullYear();
        let mm = String(today.getMonth() + 1).padStart(2, '0');
        let dd = String(today.getDate()).padStart(2, '0');
        let formatHariIni = `${yyyy}-${mm}-${dd}`;

        tglMulai = formatHariIni;
        tglSelesai = formatHariIni;

        // Otomatis sinkronkan tulisan di kotak kalender fisik HTML biar kasir tau
        if (document.getElementById("filter-tanggal-mulai")) document.getElementById("filter-tanggal-mulai").value = formatHariIni;
        if (document.getElementById("filter-tanggal-selesai")) document.getElementById("filter-tanggal-selesai").value = formatHariIni;
    }

    // PROSES EKSEKUSI PENYARINGAN DATA (FILTERING)
    dataOrder = dataOrder.filter(o => {
        const cocokKeyword =
            String(o.notaId || "").toLowerCase().includes(keyword.trim())
            || String(o.nama || "").toLowerCase().includes(keyword.trim())
            || String(o.status || "").toLowerCase().includes(keyword.trim());

        const cocokStatus =
            !filterStatus ||
            o.status === filterStatus ||
            (
                filterStatus === "PROSES"
                && (o.status === "DESAIN" || o.status === "CETAK" || o.status === "FINISHING" || o.status === "PROSES")
            );

        let cocokBayar = true;
        if (filterBayar === "LUNAS") {
            cocokBayar = (o.sisaTagihan <= 0);
        } else if (filterBayar === "BELUM_LUNAS") {
            cocokBayar = (o.sisaTagihan > 0);
        }

        // 🧠 LOGIKA RENTANG TANGGAL: Mengubah tanggal Firebase ("18 Jun 2026") menjadi format perbandingan (YYYY-MM-DD)
        let cocokTanggal = true;
        const bulanMap = {
            jan: "01", feb: "02", mar: "03", apr: "04", mei: "05", jun: "06",
            jul: "07", agu: "08", sep: "09", okt: "10", nov: "11", des: "12"
        };

        let parts = (o.tanggal || "").toLowerCase().split(" ");
        let hari = parts[0]?.padStart(2, "0");
        let bulan = bulanMap[parts[1]?.substring(0, 3)];
        let tahun = parts[2];
        let tanggalOrder = `${tahun}-${bulan}-${hari}`;

        // Jalankan sensor pembatas rentang awal s/d rentang akhir kalender
        if (tglMulai && tanggalOrder < tglMulai) {
            cocokTanggal = false;
        }
        if (tglSelesai && tanggalOrder > tglSelesai) {
            cocokTanggal = false;
        }

        return cocokKeyword && cocokStatus && cocokBayar && cocokTanggal;
    });

    // SORT DATA NOTA (FIXED: Indeks Bulan Menggunakan Angka 0-11 Agar Rumus Date Tidak Crash)
    if (currentSortField) {
        dataOrder.sort((a, b) => {
            let valA = a[currentSortField];
            let valB = b[currentSortField];

            if (currentSortField === "tanggal") {
                const bulanSortMap = {
                    jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, jun: 5,
                    jul: 6, agu: 7, sep: 8, okt: 9, nov: 10, des: 11
                };

                function parseTanggal(tgl) {
                    let parts = tgl.toLowerCase().split(" ");
                    let hari = parseInt(parts[0]) || 1;
                    let bulan = bulanSortMap[parts[1]?.substring(0, 3)] || 0;
                    let tahun = parseInt(parts[2]) || 2000;
                    return new Date(tahun, bulan, hari).getTime();
                }
                valA = parseTanggal(valA);
                valB = parseTanggal(valB);
            } else if (typeof valA === "string") {
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
            }

            if (valA < valB) return currentSortDirection === "asc" ? -1 : 1;
            if (valA > valB) return currentSortDirection === "asc" ? 1 : -1;
            return 0;
        });
    }

    // 🧠 LOGIKA LIVE REALTIME: Hitung Mini Cards Murni dari Data yang Lolos Filter Rentang Tanggal
    let countPending = 0;
    let countPiutang = 0;
    let countSelesai = 0;

    dataOrder.forEach(o => {
        if ((o.status || "").toUpperCase() === "PENDING") {
            countPending++;
        } else if ((o.status || "").toUpperCase() === "SELESAI") {
            countSelesai++;
        }

        if ((o.sisaTagihan || 0) > 0) {
            countPiutang++;
        }
    });

    // Tembak angkanya ke layar kasir depan Mini Cards
    if (document.getElementById("stat-order-pending")) document.getElementById("stat-order-pending").innerText = `${countPending} Nota`;
    if (document.getElementById("stat-order-piutang")) document.getElementById("stat-order-piutang").innerText = `${countPiutang} Nota`;
    if (document.getElementById("stat-order-selesai")) document.getElementById("stat-order-selesai").innerText = `${countSelesai} Nota`;

    // DRAW/RENDER BARIS TABEL HTML KASIR
    let html = "";
    const maxRender = 150;
    const renderData = dataOrder.slice(0, maxRender);

    renderData.forEach(o => {
        let statusDisplay = o.status;
        if (statusDisplay === "DESAIN" || statusDisplay === "CETAK" || statusDisplay === "FINISHING") {
            statusDisplay = "PROSES";
        }

        let statusPembayaran = `<span class="badge bg-danger">Belum Bayar</span>`;
        if (o.dpMasuk > 0) {
            statusPembayaran = `<span class="badge bg-warning text-dark">DP</span>`;
        }
        if (o.sisaTagihan <= 0) {
            statusPembayaran = `<span class="badge bg-success">Lunas</span>`;
        }

        html += `
        <tr class="align-middle">
            <td class="fw-bold text-dark text-nowrap">#${o.notaId}</td>
            <td class="text-nowrap text-secondary">${o.tanggal}</td>
            <td class="fw-bold text-dark" style="cursor:pointer;" onclick="window.bukaPopupDetailOrder('${o.notaId}')">
                ${o.nama}
            </td>
            <td class="text-nowrap text-dark">Rp ${o.totalBelanja.toLocaleString('id-ID')}</td>
            <td class="text-nowrap text-success">Rp ${o.dpMasuk.toLocaleString('id-ID')}</td>
            <td class="text-nowrap text-danger">Rp ${o.sisaTagihan.toLocaleString('id-ID')}</td>
            <td>${statusPembayaran}</td>
            <td>
                <select class="form-select form-select-sm fw-bold ${badgeClassOrder(statusDisplay)} border-0" style="min-width: 110px;" onchange="gantiStatusWorkflow('${o.notaId}', this.value)">
                    <option value="PENDING" ${statusDisplay === 'PENDING' ? 'selected' : ''}>PENDING</option>
                    <option value="PROSES" ${statusDisplay === 'PROSES' ? 'selected' : ''}>PROSES</option>
                    <option value="SELESAI" ${statusDisplay === 'SELESAI' ? 'selected' : ''}>SELESAI</option>
                </select>
            </td>
            <td>
                <button class="btn btn-outline-dark btn-sm fw-bold px-3 py-1 rounded-pill" onclick="window.bukaPopupDetailOrder('${o.notaId}')">Detail</button>
            </td>
        </tr>
        `;
    });

    if (dataOrder.length > maxRender) {
        html += `
        <tr>
            <td colspan="9" class="text-center text-muted py-3 fw-bold" style="background-color: var(--bg-surface);">
                <i class="fa-solid fa-circle-info text-primary me-1"></i>
                Menampilkan ${maxRender} dari ${dataOrder.length} transaksi terbaru. Gunakan kotak pencarian untuk order spesifik.
            </td>
        </tr>`;
    }

    tbody.innerHTML = html;

    // Trigger UI Kanban Update
    if (window.renderKanbanBoard) {
        window.renderKanbanBoard(dataOrder);
    }

    if (dataOrder.length === 0) {
        tbody.innerHTML = `
        <tr>
            <td colspan="9" class="text-center text-muted py-4">Tidak ada data ditemukan.</td>
        </tr>
        `;
    }
}

// 🧠 HUBUNGKAN LINK REALTIME LANGSUNG KE INPUT HTML (ZONA DOM LOADED)
// Taruh baris ini di bagian bawah script.js atau di luar fungsi render agar pemicunya mengikat realtime!
setTimeout(() => {
    const elMulai = document.getElementById("filter-tanggal-mulai");
    const elSelesai = document.getElementById("filter-tanggal-selesai");
    if (elMulai && elSelesai) {
        elMulai.addEventListener("change", () => renderTableAntrean());
        elSelesai.addEventListener("change", () => renderTableAntrean());
    }
}, 500);

window.unlockedTabs = window.unlockedTabs || [];

window.switchTab = function (targetId, elem) {
    document.querySelectorAll('.sidebar-menu .menu-item').forEach(m => m.classList.remove('active'));
    elem.classList.add('active');
    document.querySelectorAll('.tab-pane-custom').forEach(pane => pane.style.display = "none");
    document.getElementById(targetId).style.display = "block";
    document.getElementById("page-title").innerText = elem.innerText.trim();
    if (targetId === 'panel-laporan' || targetId === 'panel-dashboard') hitungDataDashboardDanLaporan();
    if (targetId === 'panel-keuangan' && typeof renderDataKeuangan === 'function') renderDataKeuangan();

    // AUTO-LOCK RESTRICTION: Jika pindah ke tab publik (Kasir, Order, Pelanggan, Dashboard)
    // Maka semua gembok akan dikunci ulang secara otomatis!
    const protectedTabs = ['panel-laporan', 'panel-pengaturan', 'panel-produk', 'panel-keuangan'];
    if (!protectedTabs.includes(targetId)) {
        window.overrideActive = false;
        window.unlockedTabs = []; // Kunci ulang semua tab
    }
};

// Variable internal penampung target tab menu sementara saat dikunci
let targetTabTerkunci = "";
let targetElemenMenu = null;

window.bukaTabProteksi = function (targetId, elem) {
    if (window.currentUserRole === 'owner' || window.unlockedTabs.includes(targetId)) {
        // Langsung buka jika owner atau tab INI sudah dibuka dengan PIN
        window.overrideActive = true; // Aktifkan sementara untuk keperluan save data di dalam tab ini
        window.switchTab(targetId, elem);
        if (typeof window._setAllNavActive === "function" && elem.id) {
            window._setAllNavActive(elem.id);
        }
        return;
    }

    // Jika staf biasa, minta PIN Owner
    targetTabTerkunci = targetId;
    targetElemenMenu = elem;

    clearAngkaPin();

    const modalEl = document.getElementById('modalPinOwnerPremium');
    const modalPin = new bootstrap.Modal(modalEl);

    // Gunakan event bawaan Bootstrap agar kursor 100% selalu fokus setelah animasi modal selesai
    modalEl.addEventListener('shown.bs.modal', function focusPin() {
        const inputPin = document.getElementById("input-pin-premium");
        if (inputPin) {
            inputPin.focus();
            inputPin.onkeydown = function (e) {
                if (e.key === "Enter") window.validasiPinPremiumOwner();
            };
        }
        // Hapus listener agar tidak menumpuk setiap kali dibuka
        modalEl.removeEventListener('shown.bs.modal', focusPin);
    });

    modalPin.show();
};

window.clearAngkaPin = function () {
    if (document.getElementById("input-pin-premium")) document.getElementById("input-pin-premium").value = "";
    if (document.getElementById("pesan-eror-pin")) document.getElementById("pesan-eror-pin").classList.add("d-none");
};

// Pengecekan PIN Owner — Validasi dengan HASH (AMAN, tidak bisa dilihat via F12 maupun database langsung)
window.validasiPinPremiumOwner = async function () {
    const inputPin = document.getElementById("input-pin-premium").value.trim();
    if (!inputPin) return;

    try {
        const snapshot = await get(ref(db, 'settings/pin_owner_hash'));
        const savedHash = snapshot.exists() ? snapshot.val() : null;

        // Jika owner belum pernah atur PIN Hash, gunakan bypass darurat (Hanya untuk masa transisi awal)
        if (!savedHash) {
            const oldSnapshot = await get(ref(db, 'settings/pin_owner'));
            const oldPin = oldSnapshot.exists() ? oldSnapshot.val() : "1234";
            if (inputPin === String(oldPin)) {
                try {
                    // Coba konversi diam-diam ke hash demi keamanan selanjutnya
                    const newHash = await hashPIN(inputPin);
                    await set(ref(db, 'settings/pin_owner_hash'), newHash);
                } catch (err) {
                    console.warn("Tidak dapat auto-migrate PIN hash (Kasir tidak punya akses write ke settings). Lanjut masuk.");
                }
                berhasilOverride();
                return;
            }
        }

        // Cek PIN secara HASH
        const inputHash = await hashPIN(inputPin);
        if (inputHash === savedHash) {
            berhasilOverride();
        } else {
            gagalOverride();
        }
    } catch (err) {
        console.error("Gagal validasi PIN:", err);
        gagalOverride();
    }
};

function berhasilOverride() {
    window.overrideActive = true;
    window.unlockedTabs = window.unlockedTabs || [];
    window.unlockedTabs.push(targetTabTerkunci); // Catat tab spesifik yang baru saja dibuka

    const modalEl = document.getElementById('modalPinOwnerPremium');
    const modalInst = bootstrap.Modal.getInstance(modalEl);
    if (modalInst) modalInst.hide();

    if (targetTabTerkunci && targetElemenMenu) {
        window.switchTab(targetTabTerkunci, targetElemenMenu);
        if (typeof window._setAllNavActive === "function" && targetElemenMenu.id) {
            window._setAllNavActive(targetElemenMenu.id);
        }
    }
    showNotification("Akses Override Diizinkan!", "success");
}

function gagalOverride() {
    document.getElementById("pesan-eror-pin").classList.remove("d-none");
    document.getElementById("input-pin-premium").value = "";
    document.getElementById("input-pin-premium").focus();
}

window.simpanPinBaru = async function () {
    if (window.currentUserRole !== 'owner' && !window.overrideActive) {
        alert("Akses ditolak. Hanya owner yang dapat mengubah PIN & Setting.");
        return;
    }
    const pinBaru = document.getElementById("setting-pin-baru").value.trim();
    const interval = document.getElementById("setting-interval-password").value.trim();

    try {
        if (pinBaru) {
            const hashBaru = await hashPIN(pinBaru);
            await set(ref(db, 'settings/pin_owner_hash'), hashBaru);
            document.getElementById("setting-pin-baru").value = "";
        }
        if (interval) {
            await set(ref(db, 'settings/system_policy/passwordChangeIntervalDays'), parseInt(interval));
        }
        showNotification("Pengaturan Keamanan Berhasil Disimpan!", "success");
    } catch (err) {
        console.error(err);
        showNotification("Gagal menyimpan keamanan.", "danger");
    }
};

// Fungsi Pengganti Alert Menjadi Notifikasi Anggun
function showNotification(msg, type = "success") {
    let statusBadge = document.getElementById("sync-status");
    if (statusBadge) {
        let oldHTML = `<i class="fa-solid fa-cloud"></i> Connected`;
        statusBadge.innerHTML = `<i class="fa-solid fa-check-double"></i> ${msg}`;
        statusBadge.className = `badge bg-${type}`;
        setTimeout(() => {
            statusBadge.innerHTML = oldHTML;
            statusBadge.className = "badge bg-success";
        }, 3000);
    }
}

window.hitungDataDashboardDanLaporan = function hitungDataDashboardDanLaporan() {
    // 1. Ambil nilai kalender Laporan & Dashboard
    const valStart = document.getElementById("report-start-date")?.value;
    const valEnd = document.getElementById("report-end-date")?.value;
    const valDbStart = document.getElementById("db-start-date")?.value;
    const valDbEnd = document.getElementById("db-end-date")?.value;

    const hariIniStr = new Date().toISOString().split('T')[0];

    // Sinkronisasi string filter tanggal ISO
    const batasAwalStr = (valStart && valStart.trim() !== "") ? valStart : hariIniStr;
    const batasAkhirStr = (valEnd && valEnd.trim() !== "") ? valEnd : hariIniStr;
    const dbAwalStr = (valDbStart && valDbStart.trim() !== "") ? valDbStart : hariIniStr;
    const dbAkhirStr = (valDbEnd && valDbEnd.trim() !== "") ? valDbEnd : hariIniStr;

    let totalOmsetPeriode = 0, totalOrderPeriode = 0, totalProses = 0, totalSelesai = 0;
    let dbOmset = 0, dbTotalOrder = 0, dbProses = 0, dbSelesai = 0;

    const reportTableBody = document.getElementById("report-table-body");
    const dbTableRecent = document.getElementById("db-table-recent");

    if (reportTableBody) reportTableBody.innerHTML = "";
    if (dbTableRecent) dbTableRecent.innerHTML = "";

    const namaBulanIndo = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    const bulanMap = {
        jan: "01", januari: "01", feb: "02", februari: "02", mar: "03", maret: "03",
        apr: "04", april: "04", mei: "05", jun: "06", juni: "06", jul: "07", juli: "07",
        agu: "08", agustus: "08", sep: "09", september: "09", okt: "10", oktober: "10",
        nov: "11", november: "11", des: "12", desember: "12"
    };

    let reportHtmlStr = "";
    let dbRecentHtmlStr = "";
    let dataLaporan = [];
    let dataDashboardRecent = [];

    // 2. Olah cache database internal Firebase
    Object.keys(masterOrdersCache).forEach(key => {
        let order = masterOrdersCache[key];
        if (!order || !order.tanggal) return;

        // Konversi tanggal teks "17 Jun 2026" -> "2026-06-17"
        let parts = order.tanggal.trim().split(/\s+/);
        let hariStr = String(parts[0]).padStart(2, '0');
        let namaBulan = parts[1] ? parts[1].toLowerCase().substring(0, 3) : "jan";
        let bulanStr = bulanMap[namaBulan] || "01";
        let tahunStr = parts[2] || "2026";
        let tanggalNotaFormatISO = `${tahunStr}-${bulanStr}-${hariStr}`;

        // Simpan ISO date untuk keperluan sorting
        order.tanggalISO = tanggalNotaFormatISO;

        // PERHITUNGAN KHUSUS TAB LAPORAN
        if (tanggalNotaFormatISO >= batasAwalStr && tanggalNotaFormatISO <= batasAkhirStr) {

            let cariVal = (document.getElementById("report-search-input")?.value || "").toLowerCase();
            let idLower = (order.notaId || "").toLowerCase();
            let nLower = (order.nama || "").toLowerCase();
            let isMatch = cariVal === "" || idLower.includes(cariVal) || nLower.includes(cariVal);

            if (isMatch) {
                totalOrderPeriode++;
                let sisa = (order.totalBelanja || 0) - (order.dpMasuk || 0);
                if (order.status !== "CANCEL" && sisa <= 0) {
                    totalOmsetPeriode += order.totalBelanja || 0;
                }
                if (order.status !== "SELESAI" && order.status !== "CANCEL") totalProses++;
                else if (order.status === "SELESAI") totalSelesai++;

                dataLaporan.push(order);
            }
        }

        // PERHITUNGAN KHUSUS TAB DASHBOARD (KOMPAK SINKRON)
        if (tanggalNotaFormatISO >= dbAwalStr && tanggalNotaFormatISO <= dbAkhirStr) {
            dbTotalOrder++;
            let sisaDb = (order.totalBelanja || 0) - (order.dpMasuk || 0);
            if (order.status !== "CANCEL" && sisaDb <= 0) {
                dbOmset += order.totalBelanja || 0;
            }
            if (order.status !== "SELESAI" && order.status !== "CANCEL") dbProses++;
            else if (order.status === "SELESAI") dbSelesai++;

            // TABEL ANTREAN MINI DI BAWAH
            if (order.status !== "SELESAI" && order.status !== "CANCEL") {
                dataDashboardRecent.push(order);
            }
        }
    });

    // --- SORTING & RENDER LAPORAN ---
    if (window.currentLaporanSort) {
        dataLaporan.sort((a, b) => {
            let valA = a[window.currentLaporanSort];
            let valB = b[window.currentLaporanSort];
            if (window.currentLaporanSort === 'tanggal') { valA = a.tanggalISO; valB = b.tanggalISO; }
            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();

            if (valA < valB) return window.currentLaporanDir === "asc" ? -1 : 1;
            if (valA > valB) return window.currentLaporanDir === "asc" ? 1 : -1;
            return 0;
        });
    } else {
        dataLaporan.sort((a, b) => a.notaId < b.notaId ? 1 : -1); // Default newest
    }

    if (reportTableBody) {
        dataLaporan.forEach(order => {
            let badgeClass = "b-pending";
            if (order.status === "PROSES") badgeClass = "b-desain";
            if (order.status === "SELESAI") badgeClass = "b-selesai";

            let itemsTeks = (order.item || []).map(i => `${i.nama} (x${i.qty})`).join(', ');
            let statusKeterangan = `<span class="badge ${badgeClass}">${order.status}</span>`;
            if (order.status === "CANCEL" && order.alasanCancel) {
                statusKeterangan += `<div class="mt-1 small fw-bold" style="color:var(--rose);">Alasan: ${order.alasanCancel}</div>`;
            }

            let aksiTombol = order.status === "CANCEL" ?
                `<span class="badge bg-secondary text-white opacity-50"><i class="fa-solid fa-ban"></i></span>` :
                `<button class="btn btn-sm btn-outline-danger fw-bold" onclick="cancelOrder('${order.notaId}')">Cancel</button>`;

            reportHtmlStr += `
            <tr class="align-middle">
                <td class="fw-bold">#${order.notaId}</td>
                <td>${order.nama}</td>
                <td class="text-truncate" style="max-width:200px;">${order.tanggal}</td>
                <td>Rp ${order.totalBelanja.toLocaleString('id-ID')}</td>
                <td class="text-success">Rp ${order.dpMasuk.toLocaleString('id-ID')}</td>
                <td>${statusKeterangan}</td>
                <td>${aksiTombol}</td>
            </tr>`;
        });
        reportTableBody.innerHTML = reportHtmlStr;
    }

    // --- SORTING & RENDER DASHBOARD ---
    if (window.currentDashboardSort) {
        dataDashboardRecent.sort((a, b) => {
            let valA = a[window.currentDashboardSort];
            let valB = b[window.currentDashboardSort];
            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();

            if (valA < valB) return window.currentDashboardDir === "asc" ? -1 : 1;
            if (valA > valB) return window.currentDashboardDir === "asc" ? 1 : -1;
            return 0;
        });
    } else {
        dataDashboardRecent.sort((a, b) => a.notaId < b.notaId ? 1 : -1); // Default newest
    }

    if (dbTableRecent) {
        dataDashboardRecent.forEach(order => {
            let badgeClass = "b-pending";
            if (order.status === "PROSES") badgeClass = "b-desain";

            dbRecentHtmlStr += `
            <tr>
                <td class="fw-bold">#${order.notaId}</td>
                <td class="fw-bold text-primary">${order.nama}</td>
                <td><span class="badge ${badgeClass}">${order.status}</span></td>
            </tr>`;
        });
        dbTableRecent.innerHTML = dbRecentHtmlStr;
    }

    // Tembak hasil hitungan ke komponen teks dashboard & laporan
    if (document.getElementById("db-omset")) document.getElementById("db-omset").innerText = `Rp ${dbOmset.toLocaleString('id-ID')}`;
    if (document.getElementById("db-total-order")) document.getElementById("db-total-order").innerText = dbTotalOrder;
    if (document.getElementById("db-proses-order")) document.getElementById("db-proses-order").innerText = dbProses;
    if (document.getElementById("db-selesai-order")) document.getElementById("db-selesai-order").innerText = dbSelesai;

    if (document.getElementById("report-omset")) document.getElementById("report-omset").innerText = `Rp ${totalOmsetPeriode.toLocaleString('id-ID')}`;
    if (document.getElementById("report-active")) document.getElementById("report-active").innerText = `${totalProses} Order`;
    if (document.getElementById("report-done")) document.getElementById("report-done").innerText = `${totalSelesai} Order`;

    // ========================================================
    // AUTO REKAP HARIAN VS BULANAN PADA GRAFIK TREN OMSET
    // ========================================================
    let dateStartObj = new Date(dbAwalStr);
    let dateEndObj = new Date(dbAkhirStr);
    let selisihWaktu = dateEndObj.getTime() - dateStartObj.getTime();
    let totalSelisihHari = Math.ceil(selisihWaktu / (1000 * 60 * 60 * 24));

    let listTanggalDinamis = {};

    if (totalSelisihHari <= 31) {
        let dateLoop = new Date(dbAwalStr);
        while (dateLoop <= dateEndObj) {
            let tglKey = `${dateLoop.getDate()} ${namaBulanIndo[dateLoop.getMonth()]} ${dateLoop.getFullYear()}`;
            listTanggalDinamis[tglKey] = 0;
            dateLoop.setDate(dateLoop.getDate() + 1);
        }
        Object.keys(masterOrdersCache).forEach(k => {
            let o = masterOrdersCache[k];
            if (o && listTanggalDinamis[o.tanggal] !== undefined && o.status !== "CANCEL") {
                let sisaTagihan = (o.totalBelanja || 0) - (o.dpMasuk || 0);
                if (sisaTagihan <= 0) listTanggalDinamis[o.tanggal] += o.totalBelanja || 0;
            }
        });
    } else {
        let dateLoop = new Date(dbAwalStr);
        while (dateLoop <= dateEndObj) {
            let bulanKey = `${namaBulanIndo[dateLoop.getMonth()]} ${dateLoop.getFullYear()}`;
            if (listTanggalDinamis[bulanKey] === undefined) listTanggalDinamis[bulanKey] = 0;
            dateLoop.setMonth(dateLoop.getMonth() + 1);
        }
        Object.keys(masterOrdersCache).forEach(k => {
            let o = masterOrdersCache[k];
            if (o && o.tanggal && o.status !== "CANCEL") {
                let sisaTagihan = (o.totalBelanja || 0) - (o.dpMasuk || 0);
                if (sisaTagihan <= 0) {
                    let oParts = o.tanggal.trim().split(/\s+/);
                    let oBulan = oParts[1] ? oParts[1].substring(0, 3) : "";
                    let oBulanBesar = oBulan.charAt(0).toUpperCase() + oBulan.slice(1).toLowerCase();
                    let oTahun = oParts[2] || "2026";
                    let keyBulanNota = `${oBulanBesar} ${oTahun}`;
                    if (listTanggalDinamis[keyBulanNota] !== undefined) listTanggalDinamis[keyBulanNota] += o.totalBelanja || 0;
                }
            }
        });
    }

    // ========================================================
    // ANALISIS PRODUK TERLARIS BERDASARKAN RENTANG TANGGAL DASHBOARD
    // ========================================================
    let hitungProdukQty = {};

    Object.keys(masterOrdersCache).forEach(key => {
        let order = masterOrdersCache[key];
        if (!order || !order.tanggal || order.status === "CANCEL") return;

        let parts = order.tanggal.trim().split(/\s+/);
        let hariStr = String(parts[0]).padStart(2, '0');
        let namaBulan = parts[1] ? parts[1].toLowerCase().substring(0, 3) : "jan";
        let bulanStr = bulanMap[namaBulan] || "01";
        let tahunStr = parts[2] || "2026";
        let tanggalNotaFormatISO = `${tahunStr}-${bulanStr}-${hariStr}`;

        if (tanggalNotaFormatISO >= dbAwalStr && tanggalNotaFormatISO <= dbAkhirStr) {
            let items = order.item || [];
            items.forEach(item => {
                let namaProduk = item.baseNama || item.nama || "Kustom / Lainnya";
                namaProduk = namaProduk.replace(/\[KUSTOM\]/gi, "").trim();

                let qtyBeli = parseInt(item.qty) || 0;

                if (!hitungProdukQty[namaProduk]) {
                    hitungProdukQty[namaProduk] = 0;
                }
                hitungProdukQty[namaProduk] += qtyBeli;
            });
        }
    });

    let sortedProduk = Object.keys(hitungProdukQty).map(nama => {
        return { nama: nama, qty: hitungProdukQty[nama] };
    });
    sortedProduk.sort((a, b) => b.qty - a.qty);

    let top5Produk = sortedProduk.slice(0, 5);

    // Jalankan penggambaran ulang kedua grafik secara serempak
    renderVisualGrafikProduk(top5Produk);
    renderVisualGrafik7Hari(listTanggalDinamis);
    
    // 📦 Tampilkan Peringatan Stok Menipis
    if (typeof window.renderLowStockWarning === 'function') {
        window.renderLowStockWarning();
    }
}

window.cancelOrder = function (notaId) {
    Swal.fire({
        title: 'Cancel Order',
        text: 'Masukkan alasan cancel order:',
        input: 'text',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Ya, Cancel Order',
        cancelButtonText: 'Kembali'
    }).then((result) => {
        if (result.isConfirmed && result.value) {
            let alasan = result.value;
            update(
                ref(db, 'orders/' + notaId),
                {
                    status: "CANCEL",
                    alasanCancel: alasan
                }
            ).then(() => {
                Swal.fire(
                    'Berhasil!',
                    'Order berhasil dicancel',
                    'success'
                );
            });
        }
    });
}
window.renderKatalog = function () {
    const katalogBox = document.getElementById("katalog-produk");
    let htmlStr = "";
    listProduk.forEach(p => {
        if (kategoriAktif !== "SEMUA" && p.kategori !== kategoriAktif) return;
        if (kataKunciProduk && !p.nama.toLowerCase().includes(kataKunciProduk)) return;
        let jenisLayanan = p.jenisLayanan || (p.hitungMeteran ? "true" : "false");
        let hargaTeks = "Rp " + p.harga.toLocaleString('id-ID') + (jenisLayanan === "true" ? "/m²" : "/lbr");

        htmlStr += `<div class="col"><div class="prod-grid-card ${produkTerpilih && produkTerpilih.id === p.id ? 'active' : ''}" onclick="pilihProduk('${p.id}')"><div class="prod-icon-box"><i class="fa-solid ${p.icon || 'fa-file-lines'} fa-lg"></i></div><div class="fw-bold text-truncate small text-dark w-100 px-1">${p.nama}</div><small class="text-danger fw-bold d-block mt-1">${hargaTeks}</small></div></div>`;
    });
    katalogBox.innerHTML = htmlStr;
};

window.jalankanPencarianProduk = function () { kataKunciProduk = document.getElementById("search-product-input").value.toLowerCase(); renderKatalog(); };

window.filterKategori = function (namaKategori) {
    kategoriAktif = namaKategori;
    document.querySelectorAll("#category-bar .cat-pill").forEach(btn => btn.classList.remove("active"));
    event.currentTarget.classList.add("active");
    renderKatalog();
};

// ========================================================
// FITUR FORM CUSTOM JOB / BIAYA TAMBAHAN KASIR KILAT
// ========================================================

window.toggleFormCustomJob = function () {
    const box = document.getElementById("custom-job-box");
    if (box) {
        if (box.style.display === "none") {
            box.style.display = "block";
            document.getElementById("custom-job-nama").focus();
        } else {
            box.style.display = "none";
        }
    }
};

window.tambahCustomJobKeKeranjang = function () {
    const namaInput = document.getElementById("custom-job-nama")?.value.trim() || "";
    const hargaInput = parseInt(document.getElementById("custom-job-harga")?.value) || 0;
    const qtyInput = parseInt(document.getElementById("custom-job-qty")?.value) || 1;

    if (namaInput === "") {
        Swal.fire({ icon: 'error', title: 'Oops...', text: 'Nama pesanan kustom tidak boleh kosong!' });
        return;
    }
    if (hargaInput <= 0) {
        Swal.fire({ icon: 'error', title: 'Oops...', text: 'Harga harus lebih besar dari 0!' });
        return;
    }

    // Karakteristik data kustom disesuaikan agar cocok dengan renderKeranjang bawaan
    const customItem = {
        baseNama: namaInput,
        nama: `[KUSTOM] ${namaInput}`,
        varian: "-",
        qty: qtyInput,
        hargaSatuan: hargaInput,
        panjang: 1,
        lebar: 1,
        jenisLayanan: "pcs",
        finishingPotong: 0,
        subtotal: hargaInput * qtyInput
    };

    keranjang.push(customItem);
    renderKeranjang();
    showNotification("Pesanan kustom berhasil masuk keranjang!", "primary");

    // Reset Form Inputan Kustom
    document.getElementById("custom-job-nama").value = "";
    document.getElementById("custom-job-harga").value = "";
    document.getElementById("custom-job-qty").value = "1";
    document.getElementById("custom-job-box").style.display = "none";
};

// FITUR: KLIK KARTU = TAMBAH +1 SEKALIGUS SINKRONISASI QTY INPUTAN
window.pilihProduk = function (id) {
    produkTerpilih = listProduk.find(p => p.id === id);
    renderKatalog();
    document.getElementById("selected-product-title").innerText = `Spesifikasi Tambahan: ${produkTerpilih.nama}`;

    const vSelect = document.getElementById("prod-varian");
    vSelect.innerHTML = "";
    if (produkTerpilih.varian && produkTerpilih.varian.length > 0) {
        produkTerpilih.varian.forEach(v => vSelect.innerHTML += `<option value="${v}">${v}</option>`);
    } else {
        vSelect.innerHTML = `<option value="-">-</option>`;
    }

    // MEMBACA JENIS HITUNG BARU DARI DATABASE (pcs, meter_min1, meter_murni)
    let jenisLayanan = produkTerpilih.jenisLayanan || "pcs";
    document.getElementById("aktifkan-jasa-potong").checked = false;
    document.getElementById("sub-form-potong-kalkulator").style.display = "none";

    // JIKA JENISNYA METERAN, TAMPILKAN INPUT PANJANG & LEBAR
    if (jenisLayanan === "meter_min1" || jenisLayanan === "meter_murni" || jenisLayanan === "true") {
        document.getElementById("box-ukuran-panjang").style.display = "block";
        document.getElementById("box-ukuran-lebar").style.display = "block";
    } else {
        document.getElementById("box-ukuran-panjang").style.display = "none";
        document.getElementById("box-ukuran-lebar").style.display = "none";
    }
    document.getElementById("box-toggle-potong").style.display = "block";
    
    let defaultVarian = produkTerpilih.varian && produkTerpilih.varian.length > 0 ? produkTerpilih.varian[0] : "-";

    if (editIndex < 0) {
        if (jenisLayanan === "pcs" || jenisLayanan === "false" || !jenisLayanan) {
            document.getElementById("spesifikasi-box").style.display = "none";
            tambahAtauUpdateKeranjang(produkTerpilih, 1, defaultVarian, 1, 1, false);
        } else {
            document.getElementById("spesifikasi-box").style.display = "block";
        }
    } else {
        document.getElementById("spesifikasi-box").style.display = "block";
    }

    let baseNama = produkTerpilih.nama;
    let itemDiKeranjang = keranjang.find(i => i.baseNama === baseNama && i.varian === defaultVarian);
    if (itemDiKeranjang) {
        document.getElementById("prod-qty").value = itemDiKeranjang.qty;
    }

    hitungPreviewHargaSistem();
};

window.tambahKeKeranjang = function () {
    if (!produkTerpilih) return;
    const varPilihan = document.getElementById("prod-varian").value;
    let qtyManual = parseInt(document.getElementById("prod-qty").value) || 1;
    let pVal = parseFloat(document.getElementById("prod-panjang").value) || 1;
    let lVal = parseFloat(document.getElementById("prod-lebar").value) || 1;
    let unitPrice = parseFloat(document.getElementById("prod-harga-manual").value) || 0;

    // Memaksa (Override) qty di keranjang dengan qty manual di input box
    const sedangEdit = editIndex >= 0;

    if (sedangEdit) {

        keranjang.splice(editIndex, 1);

        editIndex = -1;

        document.querySelector(
            '#spesifikasi-box button.btn-primary'
        ).innerHTML =
            '<i class="fa-solid fa-cart-plus me-1"></i> Tambah Manual';
    }

    tambahAtauUpdateKeranjang(produkTerpilih, qtyManual, varPilihan, pVal, lVal, true, unitPrice);

    hitungPreviewHargaSistem();
    // RESET FORM SETELAH TAMBAH / UPDATE

    if (!sedangEdit) {

        editIndex = -1;

        produkTerpilih = null;

        document.getElementById("prod-qty").value = 1;

        document.getElementById("aktifkan-jasa-potong").checked = false;

        document.getElementById("sub-form-potong-kalkulator").style.display = "none";

        document.getElementById("container-baris-per-lembar").innerHTML = "";

        document.getElementById("preview-hitung-sistem").innerHTML = "";

        document.getElementById("spesifikasi-box").style.display = "none";

    }

    document.querySelector(
        '#spesifikasi-box button.btn-primary'
    ).innerHTML =
        '<i class="fa-solid fa-cart-plus me-1"></i> Tambah Manual';

    renderKatalog();
};

function tambahAtauUpdateKeranjang(produk, qty, manualVarian, manualPanjang, manualLebar, isOverride, manualPrice = null) {
    let jenisLayanan = produk.jenisLayanan || "pcs";
    let baseNama = produk.nama;
    let namaItemDisplay = baseNama;

    let pFinal = 1;
    let lFinal = 1;
    if (jenisLayanan === "meter_min1" || jenisLayanan === "meter_murni" || jenisLayanan === "true") {
        pFinal = Math.max(manualPanjang, 0.1);
        lFinal = Math.max(manualLebar, 0.1);
        namaItemDisplay = `${baseNama} (${pFinal}x${lFinal}m)`;
    }

    let varPilihan = manualVarian || "-";
    let existingItem = keranjang.find(item => item.nama === namaItemDisplay && item.varian === varPilihan);

    if (existingItem) {
        if (isOverride) {
            existingItem.qty = qty;
        } else {
            existingItem.qty += qty;
        }
        existingItem.varianQty = existingItem.qty;
    } else {
        keranjang.push({
            baseNama: baseNama,
            nama: namaItemDisplay,
            varian: varPilihan,
            qty: qty,
            varianQty: qty,
            panjang: pFinal,
            lebar: lFinal,
            jenisLayanan: jenisLayanan,
            finishingPotong: 0,
            subtotal: 0,
            hargaSatuan: manualPrice || ambilHargaGrosirSistem(baseNama, qty)
        });
    }

    keranjang.forEach(item => {
        let hargaSatuan = item.hargaSatuan || ambilHargaGrosirSistem(item.baseNama, item.qty);
        let subtotalProduk = 0;

        // LOGIKA BARU BERDASARKAN INPUT DROP-DOWN ADMIN PRODUK
        if (item.jenisLayanan === "meter_min1" || (item.jenisLayanan === "true" && (item.baseNama.toLowerCase().includes("banner") || item.baseNama.toLowerCase().includes("spanduk")))) {
            let luasMurni = item.panjang * item.lebar;
            let luasFinal = Math.max(luasMurni, 1);
            subtotalProduk = luasFinal * hargaSatuan * item.qty;
        } else if (item.jenisLayanan === "meter_murni" || item.jenisLayanan === "true") {
            let luasMurni = item.panjang * item.lebar;
            subtotalProduk = luasMurni * hargaSatuan * item.qty;
        } else {
            subtotalProduk = hargaSatuan * item.qty;
        }

        let finishingPotong = 0;
        const aktifPotong = document.getElementById("aktifkan-jasa-potong").checked;

        if (aktifPotong && item.baseNama === produkTerpilih.nama) {
            const hargaPotong = kebijakanSistemLokal.tarifPotong || 125;
            let totalPcsPotong = 0;
            document.querySelectorAll(".input-potong-perlembar").forEach(input => {
                totalPcsPotong += parseInt(input.value) || 0;
            });
            finishingPotong = totalPcsPotong * hargaPotong;
        }
        item.subtotal = subtotalProduk + (item.finishingPotong || 0);

        if (item.nama === namaItemDisplay && item.varian === varPilihan) {
            item.finishingPotong = finishingPotong;
            item.subtotal = subtotalProduk + finishingPotong;
            item.dataPotongPerLembar = [];
            document.querySelectorAll(".input-potong-perlembar").forEach(input => {
                item.dataPotongPerLembar.push(parseInt(input.value) || 0);
            });
        }
    });

    renderKeranjang();
}

function renderKeranjang() {
    const box = document.getElementById("cart-items");
    box.innerHTML = "";

    let total = 0;

    if (keranjang.length === 0) {
        box.innerHTML = `
        <div class="text-center text-muted py-5">
            <i class="fa-solid fa-cart-shopping fa-2x mb-2 opacity-50"></i>
            <div>Keranjang kosong.</div>
        </div>`;

        document.getElementById("cart-total").innerText = "Rp 0";
        document.getElementById("payment-sisa").innerText = "Rp 0";
        let mockTotal = document.getElementById("cart-total-mock");
        if (mockTotal) mockTotal.innerText = "Rp 0";
        let nominalDiskonElem = document.getElementById("cart-diskon-nominal");
        if (nominalDiskonElem) nominalDiskonElem.innerText = "- Rp 0";
        let badgeCount = document.getElementById("cart-badge-count");
        if (badgeCount) badgeCount.innerText = "0";
        document.getElementById("payment-diskon").value = "0";

        simpanDraftOtomatis();
        return;
    }

    box.innerHTML = `<div id="cart-item-list" class="d-flex flex-column gap-2 pb-2"></div>`;

    const listContainer = document.getElementById("cart-item-list");

    keranjang.forEach((item, idx) => {

        total += item.subtotal;

        let finishingPotong = item.finishingPotong || 0;
        let subtotalProduk = item.subtotal - finishingPotong;
        let hargaSatuanItem = item.qty > 0 ? (subtotalProduk / item.qty) : 0;

        let card = document.createElement('div');
        card.style.cursor = 'pointer';
        card.className = 'p-2 rounded-3 border position-relative';
        card.style.background = 'var(--bg-elevated)';
        card.style.transition = 'all 0.2s ease';
        card.onmouseover = function () { this.style.borderColor = 'var(--accent)'; };
        card.onmouseout = function () { this.style.borderColor = 'var(--border-default)'; };
        card.onclick = function () { editItemKeranjang(idx); };

        let varianHtml = (item.varian && item.varian.trim() !== "" && item.varian !== "-") ?
            `<div style="font-size: 0.72rem; color: var(--text-muted);">Varian: ${item.varian}</div>` : "";

        let finishingHtml = finishingPotong > 0 ?
            `<div class="mt-1" style="font-size: 0.7rem; color: var(--rose);"><i class="fa-solid fa-scissors fa-sm me-1"></i>Finishing: Rp ${finishingPotong.toLocaleString('id-ID')}</div>` : "";

        card.innerHTML = `
            <div class="d-flex justify-content-between">
                <div style="padding-right: 15px;">
                    <div class="fw-bold" style="font-size: 0.85rem; color: var(--text-primary); line-height: 1.2;">${item.nama}</div>
                    ${varianHtml}
                    <div class="d-flex align-items-center gap-2 mt-1">
                        <span class="badge" style="background: var(--bg-base); color: var(--text-secondary); border: 1px solid var(--border-strong); font-size: 0.7rem;">${item.qty}x</span>
                        <span style="font-size: 0.75rem; color: var(--text-muted);">@ Rp ${hargaSatuanItem.toLocaleString('id-ID')}</span>
                    </div>
                    ${finishingHtml}
                </div>
                <div class="text-end d-flex flex-column justify-content-between align-items-end" style="min-width: 80px;">
                    <button class="btn btn-link text-danger p-0 m-0 border-0" style="font-size: 0.95rem; opacity: 0.6; transition: opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'" onclick="event.stopPropagation(); hapusItemKeranjang(${idx})" title="Hapus Item">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                    <div class="fw-bold" style="font-size: 0.9rem; color: var(--text-primary); mt-auto">Rp ${item.subtotal.toLocaleString('id-ID')}</div>
                </div>
            </div>
        `;

        listContainer.appendChild(card);
    });

    // Update cart totals and discount by calling hitungSisaTagihan
    hitungSisaTagihan();

    let badgeCount = document.getElementById("cart-badge-count");
    if (badgeCount) badgeCount.innerText = keranjang.length;

    simpanDraftOtomatis();

    hitungSisaTagihan();
}

window.editItemKeranjang = function (index) {

    let item = keranjang[index];

    editIndex = index;

    // PILIH PRODUK
    produkTerpilih =
        listProduk.find(
            p => p.nama === item.baseNama
        );

    if (!produkTerpilih) return;

    let jenisLayanan = produkTerpilih.jenisLayanan || "pcs";
    if (jenisLayanan === "meter_min1" || jenisLayanan === "meter_murni" || jenisLayanan === "true") {
        document.getElementById("box-ukuran-panjang").style.display = "block";
        document.getElementById("box-ukuran-lebar").style.display = "block";
    } else {
        document.getElementById("box-ukuran-panjang").style.display = "none";
        document.getElementById("box-ukuran-lebar").style.display = "none";
    }
    document.getElementById("box-toggle-potong").style.display = "block";

    // TAMPILKAN BOX
    document.getElementById("spesifikasi-box").style.display = "block";

    // TITLE
    document.getElementById("selected-product-title").innerText =
        `Edit Item: ${item.nama}`;

    // VARIAN
    const vSelect =
        document.getElementById("prod-varian");

    vSelect.innerHTML = "";

    if (produkTerpilih.varian?.length > 0) {

        produkTerpilih.varian.forEach(v => {

            vSelect.innerHTML +=
                `<option value="${v}">${v}</option>`;
        });
    }

    vSelect.value = item.varian;

    // QTY
    document.getElementById("prod-qty").value =
        item.qty;

    // UKURAN
    document.getElementById("prod-panjang").value =
        item.panjang || 1;

    document.getElementById("prod-lebar").value =
        item.lebar || 1;

    // HARGA MANUAL
    document.getElementById("prod-harga-manual").value = item.hargaSatuan || 0;

    // FINISHING
    if (item.finishingPotong > 0) {

        document.getElementById("aktifkan-jasa-potong").checked = true;

        toggleFormPotongFisik();
        setTimeout(() => {

            const inputs =
                document.querySelectorAll(".input-potong-perlembar");

            if (item.dataPotongPerLembar) {

                inputs.forEach((input, i) => {

                    input.value =
                        item.dataPotongPerLembar[i] || 0;
                });
            }

            hitungPreviewHargaManual();

        }, 100);
    }

    // GANTI BUTTON
    document.querySelector(
        '#spesifikasi-box button.btn-primary'
    ).innerHTML =
        '<i class="fa-solid fa-pen-to-square me-1"></i> Update Item';

    hitungPreviewHargaManual();
}

window.hapusItemKeranjang = function (index) {

    keranjang.splice(index, 1);

    renderKeranjang();

    showNotification("Item berhasil dihapus!", "danger");
}

window.bukaHistoryCustomer = function (nama) {

    let semuaOrder =
        Object.values(masterOrdersCache || {});

    let historyCustomer =
        semuaOrder.filter(o =>
            o.nama === nama
        );

    const bulanMap = {
        jan: "01", feb: "02", mar: "03", apr: "04", mei: "05", jun: "06",
        jul: "07", agu: "08", sep: "09", okt: "10", nov: "11", des: "12"
    };
    function parseTanggalIndo(tglStr) {
        if (!tglStr) return "";
        let parts = tglStr.toLowerCase().split(" ");
        if (parts.length < 3) return tglStr;
        let hari = parts[0].padStart(2, "0");
        let bulan = bulanMap[parts[1].substring(0, 3)] || "01";
        let tahun = parts[2];
        return `${tahun}-${bulan}-${hari}`;
    }

    historyCustomer.sort((a, b) => {
        let tglA = parseTanggalIndo(a.tanggal);
        let tglB = parseTanggalIndo(b.tanggal);
        if (tglA === tglB) {
            return (b.notaId || "").localeCompare(a.notaId || "");
        }
        return tglB.localeCompare(tglA);
    });

    let historySukses = historyCustomer.filter(o => o.status !== "CANCEL");
    let totalTransaksi = 0;

    historySukses.forEach(o => {
        totalTransaksi += o.totalBelanja || 0;
    });

    let orderTerakhir = historyCustomer[0]?.tanggal || "-";

    let html = "";

    if (historyCustomer.length === 0) {

        html = `
            <div class="text-center text-muted py-4">
                Tidak ada history customer
            </div>
        `;
    }

    else {
        html += `

<div class="border rounded-4 p-3 mb-4 bg-light">

    <div class="row text-center">

        <div class="col">

            <div class="small text-muted">
                Total Order
            </div>

            <div class="fw-bold fs-5 text-primary">
                ${historySukses.length}
            </div>

        </div>

        <div class="col">

            <div class="small text-muted">
                Total Belanja
            </div>

            <div class="fw-bold fs-6 text-success">
                Rp ${totalTransaksi.toLocaleString('id-ID')}
            </div>

        </div>

        <div class="col">

            <div class="small text-muted">
                Order Terakhir
            </div>

            <div class="fw-bold small">
                ${orderTerakhir}
            </div>

        </div>

    </div>

</div>

<div class="accordion" id="accordionHistory" style="max-height: 55vh; overflow-y: auto; overflow-x: hidden; padding-right: 10px;">
`;
        historyCustomer.forEach((o, index) => {
            let itemHtml = (o.item || []).map(i => {
                let showUkuran = (i.jenisLayanan === 'meter_murni' || i.jenisLayanan === 'meter_min1' || i.jenisLayanan === 'true' || String(i.jenisLayanan).includes("meter"));
                let textUkuran = (showUkuran && i.panjang && i.lebar) ? `<br><small class="text-muted">Ukuran: ${i.panjang}m x ${i.lebar}m</small>` : '';
                let textFinishing = (i.finishingPotong > 0) ? `<br><small class="text-primary">Finishing: Rp ${i.finishingPotong.toLocaleString('id-ID')}</small>` : '';
                let varian = i.varian && i.varian !== '-' ? `<span class="badge bg-secondary ms-1">${i.varian}</span>` : '';

                return `
                <tr>
                    <td class="ps-0 py-2">
                        <div class="fw-bold text-dark" style="font-size: 0.85rem;">${i.nama} ${varian}</div>
                        ${textUkuran}
                        ${textFinishing}
                    </td>
                    <td class="text-end pe-0 py-2 align-middle">
                        <div class="fw-bold" style="font-size: 0.85rem;">${i.qty}x</div>
                    </td>
                </tr>
                `;
            }).join("");

            html += `
            <div class="accordion-item mb-2 border rounded-3 shadow-sm">
                <h2 class="accordion-header" id="heading-${o.notaId}">
                    <button class="accordion-button collapsed rounded-3 p-3 bg-white" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-${o.notaId}" aria-expanded="false" aria-controls="collapse-${o.notaId}">
                        <div class="d-flex justify-content-between w-100 pe-3 align-items-center">
                            <div>
                                <div class="fw-bold text-dark mb-1">#${o.notaId}</div>
                                <div class="text-muted" style="font-size: 0.75rem;"><i class="fa-regular fa-calendar me-1"></i>${o.tanggal}</div>
                            </div>
                            <div class="text-end">
                                <div class="fw-bold text-success mb-1" style="font-size: 0.95rem;">Rp ${o.totalBelanja.toLocaleString('id-ID')}</div>
                                <span class="badge ${badgeClassOrder(o.status)}" style="font-size: 0.65rem;">${o.status}</span>
                            </div>
                        </div>
                    </button>
                </h2>
                <div id="collapse-${o.notaId}" class="accordion-collapse collapse" aria-labelledby="heading-${o.notaId}" data-bs-parent="#accordionHistory">
                    <div class="accordion-body bg-light rounded-bottom-3 p-3">
                        <table class="table table-sm table-borderless mb-2">
                            <tbody>
                                ${itemHtml}
                            </tbody>
                        </table>
                        <hr class="my-2 border-secondary opacity-25">
                        <div class="d-flex justify-content-between align-items-center mt-2">
                            <span class="small fw-bold text-muted">DP Masuk</span>
                            <span class="small fw-bold text-success">Rp ${o.dpMasuk.toLocaleString('id-ID')}</span>
                        </div>
                        <div class="d-flex justify-content-between align-items-center mt-1">
                            <span class="small fw-bold text-muted">Sisa Tagihan</span>
                            <span class="small fw-bold text-danger">Rp ${o.sisaTagihan.toLocaleString('id-ID')}</span>
                        </div>
                    </div>
                </div>
            </div>
            `;
        });
        html += `</div>`; // Tutup div accordion scrollable
    }

    document.getElementById("riwayat-pelanggan-content").innerHTML = html;
    window.tampilkanPanelSPA("panel-riwayat-pelanggan");

}

window.kalkulasiTagihan = function(keranjangArr) {
    let subtotal = keranjangArr.reduce((sum, i) => sum + i.subtotal, 0);
    let diskonPersen = parseInt(document.getElementById("payment-diskon")?.value) || 0;
    if (diskonPersen < 0) diskonPersen = 0;
    if (diskonPersen > 100) diskonPersen = 100;
    let diskonNominal = (subtotal * diskonPersen) / 100;
    let exactTotal = Math.max(0, subtotal - diskonNominal);
    let totalBulat = lakukanPembulatanKasir(exactTotal);
    let pembulatan = totalBulat - exactTotal;
    
    return { subtotal, diskonPersen, diskonNominal, exactTotal, totalBulat, pembulatan };
};

window.hitungTotalDenganDiskon = function(keranjangArr) {
    return window.kalkulasiTagihan(keranjangArr).totalBulat;
};

window.hitungSisaTagihan = function () {
    let tagihan = window.kalkulasiTagihan(keranjang);

    let mockTotal = document.getElementById("cart-total-mock");
    if (mockTotal) mockTotal.innerText = `Rp ${tagihan.subtotal.toLocaleString('id-ID')}`;

    let nominalDiskonElem = document.getElementById("cart-diskon-nominal");
    if (nominalDiskonElem) nominalDiskonElem.innerText = `- Rp ${tagihan.diskonNominal.toLocaleString('id-ID')}`;

    let dp = parseInt(document.getElementById("payment-dp").value) || 0;

    document.getElementById("cart-total").innerText = `Rp ${tagihan.totalBulat.toLocaleString('id-ID')}`;
    let selisih = tagihan.totalBulat - dp;
    let labelSisa = document.getElementById("label-payment-sisa");

    if (selisih < 0) {
        if (labelSisa) labelSisa.innerText = "Kembali:";
        document.getElementById("payment-sisa").innerText = `Rp ${Math.abs(selisih).toLocaleString('id-ID')}`;
        document.getElementById("payment-sisa").style.color = "var(--emerald)";
    } else {
        if (labelSisa) labelSisa.innerText = "Sisa:";
        document.getElementById("payment-sisa").innerText = `Rp ${selisih.toLocaleString('id-ID')}`;
        document.getElementById("payment-sisa").style.color = "var(--rose)";
    }
};

window.generateBarisPotongDinamis = function () {

    const qty =
        parseInt(document.getElementById("prod-qty").value) || 1;

    const container =
        document.getElementById("container-baris-per-lembar");

    container.innerHTML = "";

    for (let i = 1; i <= qty; i++) {

        container.innerHTML += `
        <div class="row g-2 align-items-center mb-2">

            <div class="col-5">
                <small class="fw-bold text-muted">
                    Lembar ${i}
                </small>
            </div>

            <div class="col-7">
                <input type="number" class="form-control form-control-sm input-potong-perlembar" placeholder="Jumlah pcs" value="0" min="0" oninput="hitungPreviewHargaManual()">
            </div>

        </div>`;
    }

    hitungPreviewHargaManual();
}

window.toggleFormPotongFisik = function () {

    const chk =
        document.getElementById("aktifkan-jasa-potong").checked;

    document.getElementById(
        "sub-form-potong-kalkulator"
    ).style.display =
        chk ? "block" : "none";

    // JIKA FINISHING AKTIF
    if (chk) {

        generateBarisPotongDinamis();

    }

    // JIKA FINISHING DIMATIKAN
    else {

        document.getElementById(
            "container-baris-per-lembar"
        ).innerHTML = "";
    }

    hitungPreviewHargaManual();
};

window.hitungPreviewHargaSistem = function () {
    if (!produkTerpilih) return;

    let pBox = document.getElementById("preview-hitung-sistem-text");
    let qty = parseInt(document.getElementById("prod-qty").value) || 1;
    let hargaDinamis = ambilHargaGrosirSistem(produkTerpilih.nama, qty);

    // Set system default unit price to the manual input box so user can override it
    document.getElementById("prod-harga-manual").value = hargaDinamis;

    window.hitungPreviewHargaManual();
};

window.hitungPreviewHargaManual = function () {
    if (!produkTerpilih) return;
    let pBox = document.getElementById("preview-hitung-sistem-text");
    let qty = parseInt(document.getElementById("prod-qty").value) || 1;
    let hargaManual = parseFloat(document.getElementById("prod-harga-manual").value) || 0;
    let jenisLayanan = produkTerpilih.jenisLayanan || "pcs";
    let subtotalProduk = 0;

    if (jenisLayanan === "meter_min1" || jenisLayanan === "meter_murni" || jenisLayanan === "true") {
        let p = parseFloat(document.getElementById("prod-panjang").value) || 1;
        let l = parseFloat(document.getElementById("prod-lebar").value) || 1;
        let luasMurni = p * l;
        if (jenisLayanan === "meter_min1" || (jenisLayanan === "true" && (produkTerpilih.nama.toLowerCase().includes("banner") || produkTerpilih.nama.toLowerCase().includes("spanduk")))) {
            let luasFinal = Math.max(luasMurni, 1);
            subtotalProduk = luasFinal * hargaManual * qty;
        } else {
            subtotalProduk = luasMurni * hargaManual * qty;
        }
    } else {
        subtotalProduk = hargaManual * qty;
    }

    let finishingPotong = 0;
    const aktifPotong = document.getElementById("aktifkan-jasa-potong").checked;
    let totalPcsPotong = 0;
    if (aktifPotong) {
        const hargaPotong = kebijakanSistemLokal.tarifPotong || 125;
        document.querySelectorAll(".input-potong-perlembar").forEach(input => {
            totalPcsPotong += parseInt(input.value) || 0;
        });
        finishingPotong = totalPcsPotong * hargaPotong;
    }

    let grandTotal = subtotalProduk + finishingPotong;
    if (pBox) pBox.innerText = `Rp ${grandTotal.toLocaleString('id-ID')}`;
};

window.cariPelangganLama = function () {
    const input = document.getElementById("cust-name").value.toLowerCase();
    const box = document.getElementById("suggestion-box");
    if (!box) return;
    box.innerHTML = "";

    if (!input) {
        box.style.display = "none";
        return;
    }

    Object.keys(databasePelangganLokal).forEach(k => {
        let p = databasePelangganLokal[k];
        if (p && p.nama && p.nama.toLowerCase().includes(input)) {
            let nomorHp = p.phone || "";
            // Menggunakan window.pilihPelangganSaran agar terbaca global oleh browser
            box.innerHTML += `<div class="suggest-row" onclick="window.pilihPelangganSaran('${p.nama.replace(/'/g, "\\'")}', '${nomorHp}')">${p.nama} (${nomorHp})</div>`;
        }
    });
    box.style.display = "block";
};

window.pilihPelangganSaran = function (namaCust, phoneCust) {
    if (document.getElementById("cust-name")) document.getElementById("cust-name").value = namaCust;
    if (document.getElementById("cust-phone")) document.getElementById("cust-phone").value = phoneCust;

    const box = document.getElementById("suggestion-box");
    if (box) box.style.display = "none";

    if (typeof updateBadgeStatusKasir === "function") {
        updateBadgeStatusKasir(namaCust);
    }
};

// Fungsi baru untuk memperbarui visual Badge Status Pelanggan di Kasir secara realtime
window.updateBadgeStatusKasir = function (namaCustomer) {
    const badge = document.getElementById("cust-status-badge");
    if (!badge) return;

    const inputNama = namaCustomer || document.getElementById("cust-name")?.value.trim() || "";

    if (inputNama === "") {
        badge.style.display = "none";
        return;
    }

    let matchKey = Object.keys(databasePelangganLokal).find(k => k.toLowerCase() === inputNama.toLowerCase());

    if (matchKey) {
        let dataCust = databasePelangganLokal[matchKey];
        let terakhir = parseTanggalIndonesia(dataCust.terakhirOrder);
        let sekarang = new Date();
        let selisihHari = Math.floor((sekarang - terakhir) / (1000 * 60 * 60 * 24));

        let baruKembaliDariVakum = false;
        if (dataCust.keduaTerakhirOrder && dataCust.keduaTerakhirOrder !== '-') {
            let keduaTerakhir = parseTanggalIndonesia(dataCust.keduaTerakhirOrder);
            let gapVakum = Math.floor((terakhir - keduaTerakhir) / (1000 * 60 * 60 * 24));
            if (gapVakum >= 14) {
                baruKembaliDariVakum = true;
            }
        }

        // COMPACT SINKRONISASI BADGE KASIR DEPAN
        if (selisihHari >= 14) {
            badge.innerText = "TIDAK AKTIF ⚠️";
            badge.className = "badge bg-danger";
        } else if (baruKembaliDariVakum) {
            badge.innerText = "AKTIF";
            badge.className = "badge bg-primary";
        } else if (dataCust.totalOrder >= 5) {
            badge.innerText = "LOYAL 🔥";
            badge.className = "badge bg-success";
        } else if (dataCust.totalOrder >= 3) {
            badge.innerText = "AKTIF";
            badge.className = "badge bg-primary";
        } else {
            badge.innerText = "BARU";
            badge.className = "badge bg-secondary";
        }
    } else {
        badge.innerText = "BARU";
        badge.className = "badge bg-secondary";
    }
    badge.style.display = "inline-block";
};

function generateNotaId() {

    const today = new Date();

    const yy =
        String(today.getFullYear()).slice(-2);

    const mm =
        String(today.getMonth() + 1)
            .padStart(2, '0');

    const dd =
        String(today.getDate())
            .padStart(2, '0');

    const prefix =
        `INV-${dd}${mm}${yy}`;

    let maxSeq = 0;

    Object.keys(masterOrdersCache || {}).forEach(key => {

        if (key.startsWith(prefix)) {

            let parts = key.split('-');

            let seq =
                parseInt(parts[2]) || 0;

            if (seq > maxSeq) {

                maxSeq = seq;
            }
        }
    });

    const nextSeq =
        String(maxSeq + 1)
            .padStart(3, '0');

    return `${prefix}-${nextSeq}`;
}

function siapkanAreaPrint(notaId, nama, phone, items, total, dp, sisa, isDraft = false, paymentMethod = 'Tunai', uangDiberikan = null, mode = 'print', diskonNominal = 0, pembulatan = 0) {
    if (uangDiberikan === null) uangDiberikan = dp;
    let kembali = uangDiberikan > total ? uangDiberikan - total : 0;

    // 1. Tarik komponen identitas usaha live dari input form pengaturan
    const namaTokoLive = document.getElementById("set-nama-toko")?.value || "Putra Print";
    const alamatTokoLive = document.getElementById("set-alamat-toko")?.value || "Solusi Cetak Terbaik & Cepat";
    const waTokoLive = document.getElementById("set-wa-toko")?.value || "083112347800";

    // 2. Bersihkan iframe lama terlebih dahulu (Mencegah cetak double otomatis saat di-close)
    let oldIframe = document.getElementById("print-iframe");
    if (oldIframe) {
        oldIframe.remove();
    }

    // 3. Buat Iframe baru yang segar dan bersih
    let iframe = document.createElement("iframe");
    iframe.setAttribute("id", "print-iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    document.body.appendChild(iframe);

    // 4. Susun baris item belanjaan cetak
    let barisItemsHTML = '';
    if (Array.isArray(items)) {
        items.forEach((i, idx) => {
            let finishingPotong = i.finishingPotong || 0;
            let subtotalProduk = i.subtotal - finishingPotong;
            let hargaSatuanItem = i.qty > 0 ? (subtotalProduk / i.qty) : 0;

            let namaItemLow = (i.nama || "").toLowerCase();
            let apakahKustom = namaItemLow.includes("[kustom]");

            let namaTampilan = i.nama || "Item Cetak";
            if (apakahKustom) {
                namaTampilan = namaTampilan.replace(/\[KUSTOM\]/gi, "").trim();
            }

            let adaVarianNyata = i.varian && i.varian.trim() !== "" && i.varian.trim() !== "-";

            barisItemsHTML += `
            <tr>
                <td class="text-left fw-bold" style="padding-top: 5px; padding-bottom: 5px;">${namaTampilan}${finishingPotong > 0 ? '<br><span style="font-weight: normal; color: #555; font-size: 8pt;">+ Potong: Rp ' + finishingPotong.toLocaleString('id-ID') + '</span>' : ''}</td>
                <td class="text-center" style="padding-top: 5px; padding-bottom: 5px; vertical-align: top; width: 1%; white-space: nowrap; padding-left: 5px; padding-right: 5px;">${i.qty}</td>
                <td class="text-left fw-bold" style="padding-top: 5px; padding-bottom: 5px; vertical-align: top; width: 1%; white-space: nowrap;">Rp</td>
                <td class="text-right fw-bold" style="padding-top: 5px; padding-bottom: 5px; vertical-align: top; width: 1%; white-space: nowrap; padding-left: 3px;">${i.subtotal.toLocaleString('id-ID')}</td>
            </tr>`;
        });
    }

    // 5. Gabungkan struktur nota lengkap kasir utama
    let subtotalAsli = Array.isArray(items) ? items.reduce((sum, i) => sum + i.subtotal, 0) : 0;
    if (diskonNominal === 0 && subtotalAsli > total) {
        // Fallback backward compatibility 
        diskonNominal = Math.max(0, subtotalAsli - total);
    }
    
    let htmlLengkap = `
    <html>
    <head>
        <title>Nota #${notaId}</title>
        <style>
            @page { size: 58mm auto; margin: 0; }
            body { 
                font-family: 'Courier New', Courier, monospace; 
                width: 58mm; 
                padding: 5px;
                box-sizing: border-box;
                margin: 0; 
                font-size: 8pt; 
                color: #000;
                line-height: 1.3;
            }
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .text-left { text-align: left; }
            .fw-bold { font-weight: bold; }
            .line { border-bottom: 1px dashed #000; margin: 4px 0; }
            h1 { font-size: 12pt; font-weight: bold; margin: 0 0 3px 0; text-align: center; }
            table { width: 100%; border-collapse: collapse; margin: 0; }
            td, th { vertical-align: top; padding: 1px 0; word-wrap: break-word; }
            .header-table td { font-size: 8pt; }
            .header-table td:nth-child(1) { width: 35%; white-space: nowrap; }
            .header-table td:nth-child(2) { width: 5%; text-align: center; }
            .header-table td:nth-child(3) { width: 60%; }
        </style>
    </head>
    <body>
        <div class="text-center">
            <h1>${namaTokoLive.toUpperCase()}</h1>
            <div style="font-size: 8pt; margin-bottom: 4px; color: #555;">${alamatTokoLive}</div>
            <div style="font-size: 8pt; color: #555;">WA: ${waTokoLive}</div>
        </div>
        <div class="line"></div>
        <table class="header-table">
            <tr><td>ID NOTA</td><td>:</td><td class="text-right fw-bold">${isDraft ? 'DRAFT' : '#' + notaId}</td></tr>
            <tr><td>TANGGAL</td><td>:</td><td class="text-right">${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</td></tr>
            <tr><td>KASIR</td><td>:</td><td class="text-right">${window.currentUserNama || 'Kasir'}</td></tr>
            <tr><td>CUST</td><td>:</td><td class="text-right">${nama || 'Umum'}</td></tr>
            <tr><td>TELP</td><td>:</td><td class="text-right">${phone || '-'}</td></tr>
        </table>
        <div class="line"></div>
        <table style="width: 100%;">
            <thead>
                <tr style="border-bottom: 1px solid #000;">
                    <th class="text-left fw-bold" style="padding-bottom: 2px;">Item</th>
                    <th class="text-center fw-bold" style="padding-bottom: 2px; width: 1%; white-space: nowrap; padding-left: 5px; padding-right: 5px;">Qty</th>
                    <th class="text-right fw-bold" colspan="2" style="padding-bottom: 2px;">Total</th>
                </tr>
            </thead>
            <tbody>
                ${barisItemsHTML}
            </tbody>
            <tbody>
                <tr><td colspan="4" style="border-bottom: 1px dashed #000; padding: 0;"></td></tr>
                ${diskonNominal > 0 ? `
                <tr>
                    <td colspan="2" class="fw-bold" style="white-space: nowrap; padding-top: 4px;">SUBTOTAL:</td>
                    <td class="text-left fw-bold" style="padding-top: 4px; width: 1%; white-space: nowrap;">Rp</td>
                    <td class="text-right fw-bold" style="padding-top: 4px; width: 1%; white-space: nowrap;">${subtotalAsli.toLocaleString('id-ID')}</td>
                </tr>
                <tr>
                    <td colspan="2" class="fw-bold" style="white-space: nowrap; padding-top: 4px; color: #d32f2f;">DISKON:</td>
                    <td class="text-left fw-bold" style="padding-top: 4px; width: 1%; white-space: nowrap; color: #d32f2f;">-Rp</td>
                    <td class="text-right fw-bold" style="padding-top: 4px; width: 1%; white-space: nowrap; color: #d32f2f;">${diskonNominal.toLocaleString('id-ID')}</td>
                </tr>` : ''}
                ${pembulatan !== 0 ? `
                <tr>
                    <td colspan="2" class="fw-bold" style="white-space: nowrap; padding-top: 4px;">PEMBULATAN:</td>
                    <td class="text-left fw-bold" style="padding-top: 4px; width: 1%; white-space: nowrap;">${pembulatan > 0 ? '+' : ''}Rp</td>
                    <td class="text-right fw-bold" style="padding-top: 4px; width: 1%; white-space: nowrap;">${Math.abs(pembulatan).toLocaleString('id-ID')}</td>
                </tr>` : ''}
                <tr>
                    <td colspan="2" class="fw-bold" style="white-space: nowrap; padding-top: 4px;">TOTAL:</td>
                    <td class="text-left fw-bold" style="padding-top: 4px; width: 1%; white-space: nowrap;">Rp</td>
                    <td class="text-right fw-bold" style="padding-top: 4px; width: 1%; white-space: nowrap;">${total.toLocaleString('id-ID')}</td>
                </tr>
                <tr>
                    <td colspan="2" style="color: #888; white-space: nowrap;">BAYAR (${paymentMethod}):</td>
                    <td class="text-left" style="color: #888; width: 1%; white-space: nowrap;">Rp</td>
                    <td class="text-right" style="color: #888; width: 1%; white-space: nowrap;">${uangDiberikan.toLocaleString('id-ID')}</td>
                </tr>
                ${kembali > 0 ? `
                <tr>
                    <td colspan="2" style="color: #888; white-space: nowrap;">KEMBALI:</td>
                    <td class="text-left fw-bold" style="color: #888; width: 1%; white-space: nowrap;">Rp</td>
                    <td class="text-right fw-bold" style="color: #888; width: 1%; white-space: nowrap;">${kembali.toLocaleString('id-ID')}</td>
                </tr>` : ''}
                <tr>
                    <td colspan="2" class="fw-bold" style="white-space: nowrap;">SISA:</td>
                    <td class="text-left fw-bold" style="width: 1%; white-space: nowrap;">Rp</td>
                    <td class="text-right fw-bold" style="width: 1%; white-space: nowrap;">${sisa.toLocaleString('id-ID')}</td>
                </tr>
                <tr><td colspan="4" style="border-bottom: 1px dashed #000; padding: 0; padding-top: 4px;"></td></tr>
            </tbody>
        </table>
        <div class="text-center" style="font-size: 10px; margin-top: 10px; color: #333;">
            Terima Kasih Atas Kunjungan Anda<br>
            Barang yang sudah dibeli tidak<br>dapat ditukar/dikembalikan.
        </div>
    </body>
    </html>`;

    // 6. 🧠 JALUR AMAN ANTI-DUPLIKAT: Ikat fungsi print saat iframe selesai terisi sempurna
    iframe.contentWindow.document.open();

    // Ajarkan iframe untuk otomatis mencetak HANYA SETELAH konten halamannya siap sepenuhnya
    iframe.contentWindow.onload = function () {
        if (mode === 'png') {
            html2canvas(iframe.contentDocument.body, { scale: 2, useCORS: true }).then(canvas => {
                let link = document.createElement('a');
                let namaFile = nama ? nama.replace(/\s+/g, '_') : 'Umum';
                link.download = `Draft_Invoice_${namaFile}.png`;
                link.href = canvas.toDataURL('image/png');
                link.click();
                setTimeout(() => iframe.remove(), 1000);
            }).catch(err => {
                console.error("Gagal membuat gambar PNG.", err);
            });
        } else {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        }
    };

    iframe.contentWindow.document.write(htmlLengkap);
    iframe.contentWindow.document.close();
}

function bukaWhatsApp(nama, phone, notaId, total, dp, sisa, items, diskonNominal = 0, pembulatan = 0) {
    if (!phone || phone === "-") {
        showNotification("WhatsApp pelanggan kosong!", "danger");
        return;
    }

    // 1. Tarik info nama toko live dari form pengaturan
    const namaTokoLive = document.getElementById("set-nama-toko")?.value || "Putra Print";
    const catatanWaLive = document.getElementById("set-catatan-wa")?.value || "";

    let waPhone = phone.replace(/^0/, '62').replace(/\D/g, '');
    let itemLines = "";

    // 2. Susun rincian daftar belanjaan customer
    items.forEach((i, idx) => {
        let finishingPotong = i.finishingPotong || 0;
        let subtotalProduk = i.subtotal - finishingPotong;
        let hargaSatuanItem = i.qty > 0 ? (subtotalProduk / i.qty) : 0;

        let namaItemLow = (i.nama || "").toLowerCase();
        let apakahKustom = namaItemLow.includes("[kustom]");

        let namaTampilan = i.nama;
        if (apakahKustom) {
            namaTampilan = i.nama.replace(/\[KUSTOM\]/gi, "").trim();
        }

        let adaVarianNyata = i.varian && i.varian.trim() !== "" && i.varian.trim() !== "-";

        let itemSubtotalStr = `Rp ${i.subtotal.toLocaleString('id-ID')}`;

        itemLines += `${idx + 1}. *${namaTampilan}*\n`;
        if (adaVarianNyata) {
            itemLines += `      Varian: ${i.varian}\n`;
        }
        itemLines += `      ${i.qty} x Rp ${hargaSatuanItem.toLocaleString('id-ID')}\n`;

        if (finishingPotong > 0) {
            itemLines += `      + Potong: Rp ${finishingPotong.toLocaleString('id-ID')}\n`;
        }
        itemLines += `      = ${itemSubtotalStr}\n\n`;
    });

    // 3. Gabungkan seluruh komponen menjadi satu format nota yang rapi
    let teks = `*NOTA PEMESANAN ${namaTokoLive.toUpperCase()}*\n`;
    teks += `───────────────────────────\n`;
    teks += `*No. Nota :* #${notaId}\n`;
    teks += `*Customer :* ${nama}\n`;
    teks += `───────────────────────────\n\n`;
    teks += `*📦 RINCIAN CETAKAN:*\n${itemLines}`;
    let subtotalAsli = items.reduce((sum, i) => sum + i.subtotal, 0);
    if (diskonNominal === 0 && subtotalAsli > total) {
        diskonNominal = Math.max(0, subtotalAsli - total);
    }
    
    teks += `───────────────────────────\n`;
    teks += `*💰 RINCIAN PEMBAYARAN:*\n`;
    if (diskonNominal > 0) {
        teks += `*Subtotal      :* Rp ${subtotalAsli.toLocaleString('id-ID')}\n`;
        teks += `*Diskon        :* -Rp ${diskonNominal.toLocaleString('id-ID')}\n`;
    }
    if (pembulatan !== 0) {
        teks += `*Pembulatan    :* ${pembulatan > 0 ? '+' : ''}Rp ${Math.abs(pembulatan).toLocaleString('id-ID')}\n`;
    }
    teks += `*Total Tagihan :* Rp ${total.toLocaleString('id-ID')}\n`;
    teks += `*DP / Tunai    :* Rp ${dp.toLocaleString('id-ID')}\n`;

    if (sisa <= 0) {
        teks += `*Status        :* 🎉 *LUNAS MURNI*\n`;
    } else {
        teks += `*Sisa Tagihan  :* ⚠️ *Rp ${sisa.toLocaleString('id-ID')}*\n`;
    }
    teks += `───────────────────────────\n\n`;

    // 4. Masukkan catatan otomatis dari menu pengaturan jika diisi
    if (catatanWaLive.trim() !== "") {
        teks += `${catatanWaLive}\n`;
    } else {
        teks += `Terima kasih telah mempercayakan kebutuhan cetak Anda di ${namaTokoLive}.\n`;
    }

    window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(teks)}`, "whatsappWindow");
}

window.simpanDraftPNG = function () {

    const nama = document.getElementById("cust-name").value || "Draft Customer";
    let phone = document.getElementById("cust-phone").value || "-";
    let dp = parseInt(document.getElementById("payment-dp").value) || 0;

    if (keranjang.length === 0) {
        showNotification("Keranjang belanja masih kosong!", "danger");
        return;
    }

    let tagihan = window.kalkulasiTagihan(keranjang);
    let totalBulat = tagihan.totalBulat;
    let sisaTagihan = totalBulat - dp;
    let notaId = generateNotaId().split('-')[1];

    let paymentMethod = document.getElementById("payment-method")?.value || "Tunai";
    
    showNotification("Mempersiapkan Gambar PNG...", "info");
    
    // Gunakan fungsi print dengan mode png (seperti format struk kasir yang rapi)
    siapkanAreaPrint(notaId, nama, phone, keranjang, totalBulat, Math.min(dp, totalBulat), Math.max(0, totalBulat - dp), true, paymentMethod, dp, 'png', tagihan.diskonNominal, tagihan.pembulatan);
    
    setTimeout(() => {
        showNotification("Draft PNG Berhasil Diunduh!", "primary");
    }, 1500);
};

window.populateDigitalInvoice = function(notaId, nama, phone, items, total, dp, sisa, isDraft = false) {
    const alamatTokoLive = document.getElementById("set-alamat-toko")?.value || "Solusi Cetak Terbaik & Cepat";
    const waTokoLive = document.getElementById("set-wa-toko")?.value || "083112347800";

    if(document.getElementById("p-alamat-display")) document.getElementById("p-alamat-display").innerText = alamatTokoLive;
    if(document.getElementById("p-wa-display")) document.getElementById("p-wa-display").innerText = waTokoLive;

    if(document.getElementById("p-nota-id")) document.getElementById("p-nota-id").innerText = isDraft ? "Draft Order" : notaId;
    if(document.getElementById("p-customer-nama")) document.getElementById("p-customer-nama").innerText = nama || "-";
    
    let now = new Date();
    let tgl = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) + " " + now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    if(document.getElementById("p-nota-tanggal")) document.getElementById("p-nota-tanggal").innerText = tgl;
    
    if(document.getElementById("p-nota-status")) {
        document.getElementById("p-nota-status").innerText = isDraft ? "Rincian Draft (Belum Disimpan)" : "Transaksi Berhasil (Tersimpan)";
    }

    let formattedPhone = phone && phone !== "-" ? phone.replace(/^0/, '+62') : "-";
    if(document.getElementById("p-customer-phone")) document.getElementById("p-customer-phone").innerText = formattedPhone;

    let barisItemsHTML = '';
    if (Array.isArray(items)) {
        items.forEach(i => {
            let finishingPotong = i.finishingPotong || 0;
            let subtotalProduk = i.subtotal - finishingPotong;
            let hargaSatuanItem = i.qty > 0 ? (subtotalProduk / i.qty) : 0;
            
            let namaTampilan = i.nama || "Item Cetak";
            let apakahKustom = (namaTampilan.toLowerCase().includes("[kustom]"));
            if (apakahKustom) namaTampilan = namaTampilan.replace(/\[KUSTOM\]/gi, "").trim();

            let adaVarian = i.varian && i.varian.trim() !== "" && i.varian.trim() !== "-";

            barisItemsHTML += `
            <tr style="border-bottom:1px solid #eee;">
                <td style="padding:10px 0; text-align:left;">
                    <div style="font-weight:bold; font-size:14px; color:#000;">${namaTampilan}</div>
                    ${!apakahKustom && adaVarian ? `<div style="font-size:12px; color:#555; margin-top:2px;">Varian: ${i.varian}</div>` : ''}
                    <div style="font-size:12px; color:#555; margin-top:2px;">Qty: ${i.qty} x Rp ${hargaSatuanItem.toLocaleString('id-ID')}</div>
                    ${finishingPotong > 0 ? `<div style="font-size:12px; color:#1976d2; margin-top:2px;">Finishing Potong: Rp ${finishingPotong.toLocaleString('id-ID')}</div>` : ''}
                </td>
                <td style="padding:10px 0; text-align:center; vertical-align:top; font-size:14px;">${i.qty}</td>
                <td style="padding:10px 0; text-align:right; vertical-align:top; font-weight:bold; font-size:14px;">
                    Rp ${i.subtotal.toLocaleString('id-ID')}
                </td>
            </tr>`;
        });
    }

    if(document.getElementById("p-table-items")) document.getElementById("p-table-items").innerHTML = barisItemsHTML;
    if(document.getElementById("p-grand-total")) document.getElementById("p-grand-total").innerText = `Rp ${total.toLocaleString('id-ID')}`;
    if(document.getElementById("p-dp")) document.getElementById("p-dp").innerText = `Rp ${dp.toLocaleString('id-ID')}`;
    if(document.getElementById("p-sisa")) document.getElementById("p-sisa").innerText = `Rp ${sisa.toLocaleString('id-ID')}`;
};

window.simpanTransaksi = function (tipe) {
    const nama = document.getElementById("cust-name").value;
    const namaCustomer = nama ? nama.trim() : "";

    // VALIDASI FORM UTAMA KASIR
    if (namaCustomer === "") {
        Swal.fire({ icon: 'warning', title: 'Data Belum Lengkap', text: 'Nama customer wajib diisi!' });
        return;
    }

    if (keranjang.length === 0) {
        Swal.fire({ icon: 'warning', title: 'Keranjang Kosong', text: 'Keranjang masih kosong!' });
        return;
    }

    let dp = parseInt(document.getElementById("payment-dp").value) || 0;
    let tagihan = window.kalkulasiTagihan(keranjang);
    let totalBulat = tagihan.totalBulat;

    // CEK APAKAH UANG KURANG DARI TOTAL (POTENSI PIUTANG)
    if (dp < totalBulat) {
        let sisa = totalBulat - dp;
        Swal.fire({
            title: 'Pembayaran Kurang!',
            html: `Uang dibayar kurang <b>Rp ${sisa.toLocaleString('id-ID')}</b> dari total tagihan.<br><br>Sisa ini otomatis akan dicatat sebagai <b>Piutang (Hutang)</b> pelanggan.<br><br>Apakah Anda yakin ingin melanjutkan?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#e63946',
            cancelButtonColor: '#6c757d',
            confirmButtonText: 'Ya, Lanjutkan (Masuk Piutang)',
            cancelButtonText: 'Batal'
        }).then((result) => {
            if (result.isConfirmed) {
                lanjutTanyaStrukAtauSimpan(tipe);
            }
        });
    } else {
        lanjutTanyaStrukAtauSimpan(tipe);
    }
};

function lanjutTanyaStrukAtauSimpan(tipe) {
    if (tipe === 'ASK') {
        Swal.fire({
            title: 'Cetak Struk?',
            text: "Apakah Anda ingin mencetak struk untuk transaksi ini?",
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#3085d6',
            cancelButtonColor: '#6c757d',
            confirmButtonText: '<i class="fa-solid fa-print"></i> Ya, Cetak',
            cancelButtonText: 'Tidak, Simpan Saja'
        }).then((result) => {
            if (result.isConfirmed) {
                _prosesSimpanTransaksiCloud('PRINT');
            } else {
                _prosesSimpanTransaksiCloud('SAJA');
            }
        });
    } else {
        _prosesSimpanTransaksiCloud(tipe);
    }
}

function _prosesSimpanTransaksiCloud(tipe) {
    const btnSave = document.getElementById("btn-save-transaksi");
    const btnSavePrint = document.getElementById("btn-save-print");
    const btnSaveWA = document.getElementById("btn-save-wa");

    if (btnSavePrint) btnSavePrint.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Memproses...';
    if (btnSavePrint) btnSavePrint.disabled = true;

    const nama = document.getElementById("cust-name").value;
    let phone = document.getElementById("cust-phone").value || "-";
    let dp = parseInt(document.getElementById("payment-dp").value) || 0;
    let paymentMethod = document.getElementById("payment-method")?.value || "Tunai";

    let tagihan = window.kalkulasiTagihan(keranjang);
    let totalBulat = tagihan.totalBulat;
    let subtotalAsli = tagihan.subtotal;
    let diskonNominal = tagihan.diskonNominal;
    let pembulatan = tagihan.pembulatan;

    let uangDiberikan = dp;
    if (dp > totalBulat) {
        dp = totalBulat; // Masuk ke sistem hanya sebesar total tagihan (Lunas)
    }

    let sisaTagihan = totalBulat - dp;
    let notaId = generateNotaId();
    const tglFilter = new Date().toISOString().split('T')[0];

    // KONVERSI TANGGAL TEKSTUAL AGAR SINKRON DENGAN VALIDASI VAKUM PELANGGAN
    const dateObj = tglFilter ? new Date(tglFilter) : new Date();
    const daftarBulan = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    let tgl = `${dateObj.getDate()} ${daftarBulan[dateObj.getMonth()]} ${dateObj.getFullYear()}`;

    let itemsSnapshot = [...keranjang];

    let waktuString = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const orderObj = {
        notaId: notaId, tanggal: tgl, waktu: waktuString, timestamp: Date.now(), nama: nama, phone: phone,
        subtotalBelanja: subtotalAsli, diskonNominal: diskonNominal, pembulatan: pembulatan,
        totalBelanja: totalBulat, dpMasuk: dp, sisaTagihan: sisaTagihan,
        status: "PENDING", item: itemsSnapshot,
        kasir: window.currentUserNama || 'Kasir',
        paymentMethod: paymentMethod,
        uangDiterima: uangDiberikan,
        kembalian: (uangDiberikan > totalBulat ? uangDiberikan - totalBulat : 0)
    };

    // PROSES SIMPAN KE DATABASE FIREBASE CLOUD SOLUSI CETAK
    set(ref(db, 'orders/' + notaId), orderObj).then(() => {
        masterOrdersCache[notaId] = orderObj;
        renderTableAntrean();
        hitungDataDashboardDanLaporan();

        set(ref(db, 'customers/' + nama.replace(/[\.\#\$\[\]]/g, "")), {
            nama: nama,
            phone: phone
        });

        if (typeof window.logAktivitas === 'function') {
            window.logAktivitas(editIndex >= 0 ? "EDIT_TRANSAKSI" : "TRANSAKSI_BARU", `Nota #${notaId} senilai Rp ${totalBulat.toLocaleString('id-ID')}`);
        }

        showNotification("Sukses Disimpan ke Database!", "primary");
        hapusDraftOtomatis();

        // ========================================================
        // PENYARING KONDISI (APAKAH HANYA WA, PRINT, ATAU SAVE SAJA)
        // ========================================================
        if (tipe === 'WA') {
            bukaWhatsApp(nama, phone, notaId, totalBulat, dp, sisaTagihan, itemsSnapshot, diskonNominal, pembulatan);
        }

        if (tipe === 'PRINT') {
            // 😎 CUKUP PANGGIL INI SAJA, PERINTAH WINDOW.PRINT() DI BAWAHNYA DIHAPUS!
            siapkanAreaPrint(notaId, nama, phone, itemsSnapshot, totalBulat, dp, sisaTagihan, false, paymentMethod, uangDiberikan, 'print', diskonNominal, pembulatan);
        }

        // KEMBALIKAN KONDISI TOMBOL ASLI SETELAH BERHASIL
        if (btnSave) { btnSave.disabled = false; btnSave.innerHTML = '<i class="fa-solid fa-floppy-disk me-1"></i> Simpan Transaksi'; }
        if (btnSavePrint) { btnSavePrint.disabled = false; btnSavePrint.innerHTML = '<i class="fa-solid fa-money-bill-wave d-block mb-1"></i> BAYAR SEKARANG'; }
        if (btnSaveWA) { btnSaveWA.disabled = false; btnSaveWA.innerHTML = '<i class="fa-brands fa-whatsapp me-1"></i> Simpan & Kirim WA'; }

        // RESET UTUH FORM KASIR SIAP MELAYANI PELANGGAN SELANJUTNYA
        keranjang = [];
        document.getElementById("cust-name").value = "";
        document.getElementById("cust-phone").value = "";
        document.getElementById("payment-dp").value = 0;
        document.getElementById("payment-sisa").innerText = "Rp 0";
        document.getElementById("prod-qty").value = 1;
        if (document.getElementById("spesifikasi-box")) document.getElementById("spesifikasi-box").style.display = "none";
        renderKeranjang();
        hapusDraftOtomatis();
    })
        .catch(err => {
            showNotification("Gagal Menyimpan Transaksi", "danger");
            if (btnSave) { btnSave.disabled = false; btnSave.innerHTML = '<i class="fa-solid fa-floppy-disk me-1"></i> Simpan Transaksi'; }
            if (btnSavePrint) { btnSavePrint.disabled = false; btnSavePrint.innerHTML = '<i class="fa-solid fa-money-bill-wave d-block mb-1"></i> BAYAR SEKARANG'; }
            if (btnSaveWA) { btnSaveWA.disabled = false; btnSaveWA.innerHTML = '<i class="fa-brands fa-whatsapp me-1"></i> Simpan & Kirim WA'; }
        });
};

function listenDataCloud() {
    onValue(ref(db, 'orders'), (snapshot) => {
        masterOrdersCache = snapshot.val() || {};
        renderTableAntrean();

        // Memberikan jeda waktu murni agar kalender HTML siap dibaca sempurna
        setTimeout(() => {
            hitungDataDashboardDanLaporan();
        }, 100);
    });
}

window.gantiStatusWorkflow = function (id, val) {
    const oldOrder = masterOrdersCache[id];
    if (oldOrder && oldOrder.status === 'SELESAI' && window.currentUserRole !== 'owner') {
        Swal.fire("Akses Ditolak", "Hanya Owner yang bisa mengubah status transaksi yang sudah SELESAI.", "error");
        // Re-render UI to revert the select box change
        if (typeof window.hitungDataDashboardDanLaporan === 'function') window.hitungDataDashboardDanLaporan();
        return;
    }

    update(ref(db, 'orders/' + id), { status: val }).then(() => {
        if (typeof window.logAktivitas === 'function') {
            window.logAktivitas("UBAH_STATUS", `Order #${id} menjadi ${val}`);
        }
        
        // 📦 SELECTIVE INVENTORY: Potong stok jika berubah menjadi SELESAI
        if (val === 'SELESAI' && (!oldOrder || oldOrder.status !== 'SELESAI')) {
            const itemsToDeduct = oldOrder ? (oldOrder.item || []) : [];
            itemsToDeduct.forEach(item => {
                const prodRef = ref(db, 'catalog_products/' + item.id);
                get(prodRef).then((snap) => {
                    if (snap.exists()) {
                        const prodData = snap.val();
                        // Hanya potong jika stokFisik bukan null/undefined
                        if (prodData.stokFisik !== undefined && prodData.stokFisik !== null) {
                            let sisaStok = prodData.stokFisik - parseInt(item.qty || 1);
                            update(prodRef, { stokFisik: sisaStok });
                        }
                    }
                });
            });
            
            // 📲 NOTIFIKASI WA PESANAN SELESAI
            if (oldOrder && oldOrder.phone) {
                Swal.fire({
                    title: 'Pesanan Selesai!',
                    text: 'Kirim info ke pelanggan via WhatsApp bahwa pesanan sudah siap diambil?',
                    icon: 'success',
                    showCancelButton: true,
                    confirmButtonColor: '#25D366',
                    cancelButtonColor: '#6c757d',
                    confirmButtonText: '<i class="fa-brands fa-whatsapp"></i> Ya, Kirim WA',
                    cancelButtonText: 'Tidak Perlu'
                }).then((result) => {
                    if (result.isConfirmed) {
                        let cleanPhone = oldOrder.phone.replace(/^0/, '62').replace(/\D/g, '');
                        let waText = encodeURIComponent(`Halo Kak ${oldOrder.nama}, pesanan cetak kamu di Putra Print (Nota #${oldOrder.notaId}) sudah selesai dan siap diambil ya! Terima kasih.`);
                        let waLink = `https://wa.me/${cleanPhone}?text=${waText}`;
                        window.open(waLink, '_blank');
                    }
                });
            } else {
                Swal.fire({
                    title: 'Pesanan Selesai!',
                    icon: 'success',
                    timer: 1500,
                    showConfirmButton: false
                });
            }
        }
        
        if (typeof window.hitungDataDashboardDanLaporan === 'function') window.hitungDataDashboardDanLaporan();
    });
};

function listenDatabasePelanggan() {
    onValue(ref(db, 'orders'), (snapshot) => {
        const data = snapshot.val() || {};
        databasePelangganLokal = {};

        // Penampung sementara untuk mencatat seluruh tanggal order per customer
        let customerDates = {};

        Object.keys(data).forEach(key => {
            let order = data[key];
            let nama = order.nama || '-';
            let phone = order.phone || '-';

            if (!databasePelangganLokal[nama]) {
                databasePelangganLokal[nama] = {
                    nama: nama,
                    phone: phone,
                    totalOrder: 0,
                    totalBelanja: 0,
                    terakhirOrder: '-',
                    keduaTerakhirOrder: '-' // Kolom memori baru untuk mencatat order sebelum terakhir
                };
                customerDates[nama] = [];
            }

            if (order.status !== "CANCEL") {
                databasePelangganLokal[nama].totalOrder += 1;
                databasePelangganLokal[nama].totalBelanja += order.totalBelanja || 0;

                if (order.tanggal) {
                    customerDates[nama].push(order.tanggal);
                }
            }
        });

        // LOGIKA PENYARING URUTAN TANGGAL
        Object.keys(databasePelangganLokal).forEach(nama => {
            let dates = customerDates[nama];
            if (dates && dates.length > 0) {
                // Urutkan seluruh riwayat tanggal dari yang paling baru ke paling lama
                dates.sort((a, b) => parseTanggalIndonesia(b).getTime() - parseTanggalIndonesia(a).getTime());

                // Ambil 2 tanggal teratas
                databasePelangganLokal[nama].terakhirOrder = dates[0] || '-';
                databasePelangganLokal[nama].keduaTerakhirOrder = dates[1] || '-';
            }
        });

        renderTablePelanggan();
    });
}

window.simpanPengaturanToko = function () {
    if (window.currentUserRole !== 'owner') {
        Swal.fire('Akses Ditolak', 'Hanya Owner yang dapat menyimpan pengaturan toko. PIN ini hanya memberikan akses pantau.', 'error');
        return;
    }
    const data = {
        namaToko: document.getElementById("set-nama-toko").value,
        waToko: document.getElementById("set-wa-toko").value,
        alamat: document.getElementById("set-alamat-toko").value,
        catatanWa: document.getElementById("set-catatan-wa").value // <-- Tambahan sinkronisasi teks catatan WA
    };
    set(ref(db, 'settings/profile'), data).then(() => showNotification("Profil Identitas Usaha Disimpan!", "success"));
};

// Variable global penampung kebijakan sistem realtime (agar bisa dibaca oleh fungsi kasir & loyalitas)
let kebijakanSistemLokal = { tarifPotong: 125, metodePembulatan: 500, hariVakum: 14, minOrderLoyal: 5 };

function loadPengaturanSistem() {
    // 1. Membaca Identitas Profil Usaha
    onValue(ref(db, 'settings/profile'), (snapshot) => {
        const data = snapshot.val();
        if (data) {
            if (document.getElementById("set-nama-toko")) document.getElementById("set-nama-toko").value = data.namaToko || "Putra Print";
            if (document.getElementById("set-wa-toko")) document.getElementById("set-wa-toko").value = data.waToko || "";
            if (document.getElementById("set-alamat-toko")) document.getElementById("set-alamat-toko").value = data.alamat || "";
            if (document.getElementById("set-catatan-wa")) document.getElementById("set-catatan-wa").value = data.catatanWa || "";

            if (document.getElementById("p-alamat-display")) document.getElementById("p-alamat-display").innerText = data.alamat || "";
            if (document.getElementById("p-wa-display")) document.getElementById("p-wa-display").innerText = data.waToko || "";
        }
    });

    // 2. Membaca Live Kebijakan Operasional Toko (Dinamis dari Firebase Cloud)
    onValue(ref(db, 'settings/system_policy'), (snapshot) => {
        const policy = snapshot.val();
        if (policy) {
            kebijakanSistemLokal = policy; // Simpan ke memori lokal sistem

            // Set nilai ke kotak input form pengaturan agar admin bisa memantau
            if (document.getElementById("set-tarif-potong")) document.getElementById("set-tarif-potong").value = policy.tarifPotong || 125;
            if (document.getElementById("set-pembulatan")) document.getElementById("set-pembulatan").value = policy.metodePembulatan !== undefined ? policy.metodePembulatan : 500;
            if (document.getElementById("set-hari-vakum")) document.getElementById("set-hari-vakum").value = policy.hariVakum || 14;
            if (document.getElementById("set-min-loyal")) document.getElementById("set-min-loyal").value = policy.minOrderLoyal || 5;
        }
    });
}

function renderTabelAdminProduk() {
    const tbody = document.getElementById("adm-table-produk");
    tbody.innerHTML = "";
    const keyword =
        document
            .getElementById("search-produk-admin")
            ?.value
            ?.toLowerCase()
            ?.trim() || "";
    let dataProduk = [...listProduk];

    dataProduk = dataProduk.filter(p => {

        const nama =
            p.nama.toLowerCase();

        const kategori =
            (p.kategori || "")
                .toLowerCase();

        return (
            nama.includes(keyword.trim())
            ||
            kategori.includes(keyword.trim())
        );

    });

    // SORT

    if (currentProdukSort) {

        dataProduk.sort((a, b) => {

            let valA = a[currentProdukSort];
            let valB = b[currentProdukSort];

            if (typeof valA === "string") {

                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
            }

            if (valA < valB)
                return currentProdukDirection === "asc"
                    ? -1
                    : 1;

            if (valA > valB)
                return currentProdukDirection === "asc"
                    ? 1
                    : -1;

            return 0;
        });
    }
    let htmlStr = "";
    dataProduk.forEach(p => {
        htmlStr += `
<tr>
<td>
<div class="fw-bold text-truncate" style="max-width:220px;">
${p.nama}
</div>
</td>
<td>
${p.kategori}
</td>
<td>
Rp ${p.harga.toLocaleString('id-ID')}
</td>
<td>
<div class="d-flex gap-1 justify-content-center">
<button
class="btn btn-warning btn-sm"
onclick="editProduk('${p.id}')"
>
<i class="fa-solid fa-pen"></i>
</button>
<button
class="btn btn-outline-danger btn-sm"
onclick="hapusProdukDariAdmin('${p.id}')"
>
<i class="fa-solid fa-trash"></i>
</button>
</div>
</td>
</tr>
`;
    });
    tbody.innerHTML = htmlStr;
}

window.simpanProdukDariAdmin = function () {
    if (window.currentUserRole !== 'owner') {
        Swal.fire('Akses Ditolak', 'Staf tidak berhak mengubah/menambahkan data produk utama.', 'error');
        return;
    }
    let id = document.getElementById("adm-prod-id").value || "PROD-" + Date.now();
    const data = {
        id: id,
        nama: document.getElementById("adm-prod-nama").value,
        kategori: document.getElementById("adm-prod-kategori").value,
        harga: parseInt(document.getElementById("adm-prod-harga").value) || 0,
        jenisLayanan: document.getElementById("adm-prod-hitung").value,
        icon: document.getElementById("adm-prod-icon").value,
        varian: document.getElementById("adm-prod-varian").value.split(',').map(v => v.trim()),
        // 💰 DATA GROSIR BARU SINKRON KE FIREBASE CLOUD
        grosirQty: parseInt(document.getElementById("adm-prod-grosir-qty").value) || 0,
        grosirHarga: parseInt(document.getElementById("adm-prod-grosir-harga").value) || 0,
        // 📦 SELECTIVE INVENTORY
        stokFisik: document.getElementById("adm-prod-stok").value !== "" ? parseInt(document.getElementById("adm-prod-stok").value) : null
    };
    set(ref(db, 'catalog_products/' + id), data).then(() => {
        showNotification("Data Master Pricelist Berhasil Diperbarui!", "success");
        resetFormAdmin();
    });
};

window.hapusProdukDariAdmin = function (id) {
    if (window.currentUserRole !== 'owner') {
        Swal.fire('Akses Ditolak', 'Staf tidak berhak menghapus data produk utama.', 'error');
        return;
    }
    Swal.fire({
        title: 'Hapus Produk?',
        text: "Data tidak bisa dikembalikan!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Ya, Hapus!'
    }).then((result) => {
        if (result.isConfirmed) {
            remove(ref(db, 'catalog_products/' + id));
            Swal.fire('Terhapus!', 'Produk berhasil dihapus.', 'success');
        }
    });
};
window.resetFormAdmin = function () {
    document.getElementById("adm-prod-id").value = "";
    document.getElementById("adm-prod-nama").value = "";
    document.getElementById("adm-prod-harga").value = "";
    document.getElementById("adm-prod-varian").value = "";
    if (document.getElementById("adm-prod-stok")) document.getElementById("adm-prod-stok").value = "";

    // Ganti .selectedIndex menjadi .value = "" agar tidak eror
    if (document.getElementById("adm-prod-kategori")) document.getElementById("adm-prod-kategori").value = "";
    if (document.getElementById("adm-prod-icon")) document.getElementById("adm-prod-icon").value = "fa-file-lines";

    if (document.getElementById("adm-prod-grosir-qty")) document.getElementById("adm-prod-grosir-qty").value = 0;
    if (document.getElementById("adm-prod-grosir-harga")) document.getElementById("adm-prod-grosir-harga").value = 0;

    document.getElementById("admin-form-title").innerHTML = '<i class="fa-solid fa-square-plus me-2"></i>Kelola Jasa / Bahan';
};

function bukaPopupDetailOrder(notaId) {

    let order =
        masterOrdersCache[notaId];

    if (!order) {
        Swal.fire({ icon: 'error', title: 'Oops...', text: 'Detail order tidak ditemukan' });
        return;
    }

    let html = `
        <div class="receipt-header text-center mb-4 pb-3 border-bottom border-dashed">
            <h5 class="fw-bold mb-1">#${order.notaId}</h5>
            <small class="text-muted d-block mb-3">${order.tanggal} ${order.waktu ? '- ' + order.waktu : ''}</small>
            
            <div class="d-flex justify-content-between text-start bg-light p-3 rounded-3">
                <div>
                    <small class="text-muted d-block" style="font-size: 11px;">Customer</small>
                    <span class="fw-bold text-dark">${order.nama}</span>
                </div>
                <div class="text-end">
                    <small class="text-muted d-block" style="font-size: 11px;">No. WhatsApp</small>
                    <span class="fw-bold text-dark">${order.phone || '-'}</span>
                </div>
            </div>
        </div>

        <div class="receipt-items mb-4">
    `;

    (order.item || []).forEach((i, index) => {
        let finishing = i.finishingPotong || 0;
        let subtotalProduk = i.subtotal - finishing;

        html += `
            <div class="d-flex justify-content-between mb-3 pb-2 border-bottom border-light">
                <div>
                    <div class="fw-bold text-dark mb-1" style="font-size: 14px;">${i.nama}</div>
                    <div class="text-muted" style="font-size: 12px;">Varian: ${i.varian || '-'}</div>
                    <div class="text-muted" style="font-size: 12px;">Qty: ${i.qty}</div>
                    ${finishing > 0 ? `<div class="text-primary mt-1" style="font-size: 11px;"><i class="fa-solid fa-scissors"></i> Finishing: Rp ${finishing.toLocaleString('id-ID')}</div>` : ''}
                </div>
                <div class="text-end">
                    <div class="fw-bold text-dark" style="font-size: 14px;">Rp ${subtotalProduk.toLocaleString('id-ID')}</div>
                </div>
            </div>
        `;
    });

    let subtotalAsli = order.subtotalBelanja !== undefined ? order.subtotalBelanja : (order.item || []).reduce((sum, i) => sum + i.subtotal, 0);
    let diskonNominal = order.diskonNominal !== undefined ? order.diskonNominal : 0;
    let pembulatan = order.pembulatan !== undefined ? order.pembulatan : 0;

    if (order.diskonNominal === undefined && subtotalAsli > order.totalBelanja) {
        diskonNominal = Math.max(0, subtotalAsli - order.totalBelanja);
    }

    html += `
        </div>
        
        <div class="receipt-summary bg-light p-3 rounded-3 mb-4">
            <div class="d-flex justify-content-between mb-2">
                <span class="text-muted">Subtotal</span>
                <span class="fw-bold text-dark fs-6">Rp ${subtotalAsli.toLocaleString('id-ID')}</span>
            </div>
            ${diskonNominal > 0 ? `
            <div class="d-flex justify-content-between mb-2">
                <span class="text-muted text-danger">Diskon</span>
                <span class="fw-bold text-danger fs-6">- Rp ${diskonNominal.toLocaleString('id-ID')}</span>
            </div>` : ''}
            ${pembulatan !== 0 ? `
            <div class="d-flex justify-content-between mb-2">
                <span class="text-muted text-warning">Pembulatan</span>
                <span class="fw-bold text-warning fs-6">${pembulatan > 0 ? '+' : ''}Rp ${Math.abs(pembulatan).toLocaleString('id-ID')}</span>
            </div>` : ''}
            <div class="d-flex justify-content-between mb-2 border-top pt-2">
                <span class="text-muted">Total Transaksi</span>
                <span class="fw-bold text-dark fs-6">Rp ${order.totalBelanja.toLocaleString('id-ID')}</span>
            </div>
            <div class="d-flex justify-content-between mb-2">
                <span class="text-muted">Terbayar (DP)</span>
                <span class="fw-bold text-success fs-6">Rp ${order.dpMasuk.toLocaleString('id-ID')}</span>
            </div>
            <div class="d-flex justify-content-between pt-2 mt-2 border-top border-dashed">
                <span class="fw-bold text-dark">Sisa Tagihan</span>
                <span class="fw-bold text-danger fs-5">Rp ${order.sisaTagihan.toLocaleString('id-ID')}</span>
            </div>
        </div>
    `;

    html += `
    <div class="d-flex gap-2 mb-2">
        <button
            class="btn btn-primary flex-grow-1 fw-bold"
            onclick="window.cetakUlangStruk('${order.notaId}')"
        >
            <i class="fa-solid fa-print me-2"></i>
            Cetak Struk
        </button>
        <button
            class="btn btn-outline-primary fw-bold"
            onclick="window.repeatOrder('${order.notaId}')"
            title="Pesan ulang pesanan ini"
        >
            <i class="fa-solid fa-copy me-1"></i>
            Repeat Order
        </button>
    </div>
    `;

    if (order.sisaTagihan > 0) {
        html += `
        <div class="mt-4 p-3 rounded-3 border" style="background:#f8f9fa;">
            <h6 class="fw-bold text-dark mb-3"><i class="fa-solid fa-money-bill-wave me-2 text-success"></i>Form Pelunasan</h6>
            <div class="input-group mb-3">
                <span class="input-group-text bg-white fw-bold">Rp</span>
                <input type="number" id="input-pelunasan-inline" class="form-control form-control-lg fw-bold text-success" placeholder="Nominal Uang..." value="${order.sisaTagihan}">
            </div>
            <button
                class="btn btn-success w-100 fw-bold shadow-sm py-2"
                onclick="window.prosesPelunasanInline('${order.notaId}')"
            >
                Konfirmasi Pelunasan
            </button>
        </div>
        `;
    }

    document.getElementById("detail-order-content").innerHTML = html;
    window.tampilkanPanelSPA("panel-detail-order");
}

window.kembaliKeOrder = function() {
    switchTab('panel-order', document.getElementById('menu-order'));
};

window.kembaliKePelanggan = function() {
    switchTab('panel-pelanggan', document.getElementById('menu-pelanggan'));
};

window.tampilkanPanelSPA = function(panelId) {
    document.querySelectorAll('.tab-pane-custom').forEach(tab => {
        tab.style.display = 'none';
        tab.classList.remove('active');
    });
    const p = document.getElementById(panelId);
    if(p) {
        p.style.display = 'block';
        p.classList.add('active');
    }
};

window.prosesPelunasanInline = function(id) {
    let order = masterOrdersCache[id];
    let bayar = parseInt(document.getElementById("input-pelunasan-inline").value) || 0;
    
    if (bayar < 1) {
        Swal.fire('Error', 'Nominal pelunasan tidak valid', 'error');
        return;
    }

    if (bayar > order.sisaTagihan) {
        Swal.fire('Error', 'Nominal tidak boleh melebihi sisa tagihan!', 'error');
        return;
    }

    let dpBaru = order.dpMasuk + bayar;
    let sisaBaru = order.totalBelanja - dpBaru;
    
    // Status bisa otomatis SELESAI atau tetap (tergantung kebutuhan, kita biarkan saja sesuai order.status saat ini)
    let statusBaru = order.status;

    update(ref(db, 'orders/' + id), {
        dpMasuk: dpBaru,
        sisaTagihan: sisaBaru,
        status: statusBaru
    }).then(() => {
        Swal.fire('Berhasil!', 'Pelunasan berhasil dicatat.', 'success').then(() => {
            window.kembaliKeOrder();
            if (typeof window.hitungDataDashboardDanLaporan === 'function') window.hitungDataDashboardDanLaporan();
        });
        if (typeof window.logAktivitas === 'function') {
            window.logAktivitas("PELUNASAN", `Melunasi Rp ${bayar} untuk nota #${id}`);
        }
    });
};

window.bukaPopupDetailOrder =
    bukaPopupDetailOrder;

window.repeatOrder = function(notaId) {
    let order = masterOrdersCache[notaId];
    if (!order) return;
    
    // Copy item to keranjang
    keranjang = JSON.parse(JSON.stringify(order.item || []));
    
    // Copy customer info
    document.getElementById("cust-name").value = order.nama || "";
    document.getElementById("cust-phone").value = order.phone || "";

    // Hitung diskon yang sebelumnya dipakai
    let subtotalAsli = order.subtotalBelanja !== undefined ? order.subtotalBelanja : keranjang.reduce((sum, i) => sum + i.subtotal, 0);
    let diskonNominal = order.diskonNominal !== undefined ? order.diskonNominal : Math.max(0, subtotalAsli - order.totalBelanja);
    let diskonPersen = subtotalAsli > 0 ? Math.round((diskonNominal / subtotalAsli) * 100) : 0;
    
    let diskonInput = document.getElementById("payment-diskon");
    if(diskonInput) diskonInput.value = diskonPersen;
    
    // Close modal
    const modalEl = document.getElementById('detailOrderModal');
    if (modalEl) {
        const modalInst = bootstrap.Modal.getInstance(modalEl);
        if (modalInst) modalInst.hide();
    }
    
    // Switch to POS tab if not already
    switchTab('panel-kasir', document.getElementById('menu-kasir'));
    
    renderKeranjang();
    Swal.fire({
        icon: 'success',
        title: 'Repeat Order Berhasil',
        text: 'Item telah dimasukkan ke keranjang kasir.',
        timer: 2000,
        showConfirmButton: false
    });
};

function simpanDraftOtomatis() {

    const dataDraft = {

        customerNama:
            document.getElementById("cust-name")?.value || "",

        customerPhone:
            document.getElementById("cust-phone")?.value || "",

        dp:
            document.getElementById("payment-dp")?.value || 0,

        keranjang:
            keranjang
    };

    localStorage.setItem(
        "draft_kasir_putra_print",
        JSON.stringify(dataDraft)
    );
}

function loadDraftOtomatis() {

    const data =
        localStorage.getItem(
            "draft_kasir_putra_print"
        );

    if (!data) return;

    const draft =
        JSON.parse(data);

    keranjang =
        draft.keranjang || [];

    document.getElementById(
        "cust-name"
    ).value =
        draft.customerNama || "";

    document.getElementById(
        "cust-phone"
    ).value =
        draft.customerPhone || "";

    document.getElementById(
        "payment-dp"
    ).value =
        draft.dp || 0;

    renderKeranjang();
}

function hapusDraftOtomatis() {

    localStorage.removeItem(
        "draft_kasir_putra_print"
    );
}

function clearDraftKasir() {
    Swal.fire({
        title: 'Batalkan Draft?',
        text: "Keranjang akan dikosongkan dan tidak bisa dikembalikan!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Ya, Kosongkan!',
        cancelButtonText: 'Kembali'
    }).then((result) => {
        if (result.isConfirmed) {
            keranjang = [];
            document.getElementById("cust-name").value = "";
            document.getElementById("cust-phone").value = "";
            document.getElementById("payment-dp").value = 0;
            hapusDraftOtomatis();
            renderKeranjang();
            showNotification("Draft berhasil dibersihkan", "danger");
        }
    });
}

window.clearDraftKasir =
    clearDraftKasir;

function bukaPelunasan(notaId) {
    let order = masterOrdersCache[notaId];
    if (!order) {
        Swal.fire({ icon: 'error', title: 'Oops...', text: 'Data nota tidak ditemukan!' });
        return;
    }

    let sisa = order.sisaTagihan || 0;
    Swal.fire({
        title: 'Pelunasan',
        html: `
            <div class="text-start mb-3">
                <label class="form-label fw-bold" style="font-size:0.85rem;">Masukkan nominal pelunasan:</label>
                <input type="number" id="swal-pelunasan-nominal" class="form-control" value="${sisa}" max="${sisa}">
            </div>
            <div class="text-start mb-1">
                <label class="form-label fw-bold" style="font-size:0.85rem;">Metode Bayar Pelunasan:</label>
                <select id="swal-pelunasan-method" class="form-select">
                    <option value="Tunai">💵 Tunai</option>
                    <option value="TF">🏦 Transfer</option>
                    <option value="QR">📱 QRIS</option>
                </select>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Proses Pelunasan',
        cancelButtonText: 'Batal',
        preConfirm: () => {
            let val = parseInt(document.getElementById('swal-pelunasan-nominal').value);
            let method = document.getElementById('swal-pelunasan-method').value;
            if (!val || val <= 0) { Swal.showValidationMessage('Nominal tidak valid!'); return false; }
            if (val > sisa) { Swal.showValidationMessage('Nominal melebihi sisa!'); return false; }
            return { nominal: val, method: method };
        }
    }).then((result) => {
        if (result.isConfirmed) {
            let nominal = result.value.nominal;
            let method = result.value.method;
            let dpBaru = (order.dpMasuk || 0) + nominal;
            let sisaBaru = (order.totalBelanja || 0) - dpBaru;

            update(ref(db, 'orders/' + notaId), {
                dpMasuk: dpBaru,
                sisaTagihan: sisaBaru,
                paymentMethod: method
            }).then(() => {
                if (typeof window.logAktivitas === 'function') {
                    window.logAktivitas("PELUNASAN", `Order #${notaId}: Bayar Rp ${nominal.toLocaleString('id-ID')} via ${method}`);
                }
                masterOrdersCache[notaId].dpMasuk = dpBaru;
                masterOrdersCache[notaId].sisaTagihan = sisaBaru;

                if (sisaBaru <= 0) {
                    Swal.fire({ icon: 'success', title: 'LUNAS!', text: `MANTAP! Nota #${notaId} lunas total.`, timer: 2000, showConfirmButton: false });
                } else {
                    Swal.fire({ icon: 'info', title: 'Berhasil', text: `Pelunasan berhasil. Sisa: Rp ${sisaBaru.toLocaleString('id-ID')}`, timer: 2000, showConfirmButton: false });
                }

                const modalEl = document.getElementById('detailOrderModal');
                if (modalEl) {
                    const modalInst = bootstrap.Modal.getInstance(modalEl);
                    if (modalInst) modalInst.hide();
                }

                if (typeof hitungDataDashboardDanLaporan === "function") {
                    hitungDataDashboardDanLaporan();
                }
                renderTableAntrean();
            }).catch((error) => {
                console.error("Gagal update:", error);
                Swal.fire({ icon: 'error', title: 'Error', text: 'Terjadi kesalahan saat menyimpan ke database.' });
            });
        }
    });
}

window.bukaPelunasan =
    bukaPelunasan;

const elKategori = document.getElementById("adm-prod-kategori");
if (elKategori) {
    elKategori.addEventListener("change", function () {

        const kategori = this.value;

        const iconSelect =
            document.getElementById("adm-prod-icon");

        if (kategori === "Print & Copy") {

            iconSelect.value = "fa-file-lines";

        }

        else if (kategori === "A3+") {

            iconSelect.value = "fa-print";

        }

        else if (kategori === "Large Format") {

            iconSelect.value = "fa-scroll";

        }

        else if (kategori === "Finishing") {

            iconSelect.value = "fa-scissors";

        }

        else if (kategori === "Tambahan") {

            iconSelect.value = "fa-tags";

        }

    });
}

function parseTanggalIndonesia(tanggal) {
    if (!tanggal || typeof tanggal !== "string" || tanggal === "-") {
        return new Date();
    }

    // PERBAIKAN TOTAL: Memetakan indeks bulan zero-based (0-11) secara tepat dan presisi
    const bulanMap = {
        jan: 0, januari: 0,
        feb: 1, februari: 1,
        mar: 2, maret: 2,
        apr: 3, april: 3,
        mei: 4,
        jun: 5, juni: 5,
        jul: 6, juli: 6,
        agu: 7, agustus: 7,
        sep: 8, september: 8,
        okt: 9, oktober: 9,
        nov: 10, november: 10,
        des: 11, desember: 11
    };

    let parts = tanggal.trim().split(/\s+/);
    let hari = parseInt(parts[0]) || 1;

    let namaBulan = parts[1] ? parts[1].toLowerCase().substring(0, 3) : "jan";
    let bulan = bulanMap[namaBulan] !== undefined ? bulanMap[namaBulan] : 0;

    let tahun = parseInt(parts[2]) || new Date().getFullYear();

    // Mengunci jam ke format siang hari agar tidak terpotong masalah pembulatan waktu regional (timezone)
    return new Date(tahun, bulan, hari, 12, 0, 0, 0);
}

function renderTablePelanggan() {
    const tbody = document.getElementById("pelanggan-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    const keyword = document.getElementById("search-pelanggan-input")?.value?.toLowerCase()?.trim() || "";

    let totalPelangganSistem = 0;
    let totalPoinSistem = 0;
    let totalOmsetPelangganSistem = 0;

    let dataPelangganFiltered = Object.values(databasePelangganLokal).filter(c => {
        const nama = (c.nama || "").toLowerCase();
        const phone = (c.phone || "").toLowerCase();
        return nama.includes(keyword) || phone.includes(keyword);
    });

    Object.values(databasePelangganLokal).forEach(c => {
        totalPelangganSistem++;
        totalOmsetPelangganSistem += c.totalBelanja || 0;
        totalPoinSistem += c.totalOrder || 0;
    });

    if (document.getElementById("cust-stat-total")) document.getElementById("cust-stat-total").innerText = `${totalPelangganSistem} Orang`;
    if (document.getElementById("cust-stat-poin")) document.getElementById("cust-stat-poin").innerText = `${totalPoinSistem} Nota`;
    if (document.getElementById("cust-stat-omset")) document.getElementById("cust-stat-omset").innerText = `Rp ${totalOmsetPelangganSistem.toLocaleString('id-ID')}`;

    if (dataPelangganFiltered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">Data pelanggan tidak ditemukan.</td></tr>`;
        return;
    }

    dataPelangganFiltered.forEach(c => {
        let status = `<span class="badge bg-secondary">BARU</span>`;
        let terakhir = parseTanggalIndonesia(c.terakhirOrder);
        let sekarang = new Date();
        let selisihHari = Math.floor((sekarang - terakhir) / (1000 * 60 * 60 * 24));

        let baruKembaliDariVakum = false;
        if (c.keduaTerakhirOrder && c.keduaTerakhirOrder !== '-') {
            let keduaTerakhir = parseTanggalIndonesia(c.keduaTerakhirOrder);
            let gapVakum = Math.floor((terakhir - keduaTerakhir) / (1000 * 60 * 60 * 24));
            if (gapVakum >= 14) baruKembaliDariVakum = true;
        }

        if (selisihHari >= 14) {
            status = `<span class="badge bg-danger">TIDAK AKTIF ⚠️</span>`;
        } else if (baruKembaliDariVakum) {
            status = `<span class="badge bg-primary">AKTIF</span>`;
        } else if (c.totalOrder >= 5) {
            status = `<span class="badge bg-success">LOYAL 🔥</span>`;
        } else if (c.totalOrder >= 3) {
            status = `<span class="badge bg-primary">AKTIF</span>`;
        } else {
            status = `<span class="badge bg-secondary">BARU</span>`;
        }

        let waNumber = (c.phone || "").replace(/^0/, "62").replace(/\D/g, "");

        tbody.innerHTML += `
        <tr class="align-middle">
            <td class="fw-bold text-dark ps-3 text-nowrap" style="cursor:pointer;" onclick="bukaHistoryCustomer('${c.nama}')">
                ${c.nama}
            </td>
            <td class="text-nowrap">
                <a href="https://wa.me/${waNumber}" target="_blank" class="text-success fw-bold text-decoration-none">
                    <i class="fa-brands fa-whatsapp me-1"></i> ${c.phone}
                </a>
            </td>
            <td class="text-nowrap"><span class="fw-bold text-secondary">${c.totalOrder || 0}x</span></td> 
            <td class="text-dark fw-bold text-nowrap">Rp ${(c.totalBelanja || 0).toLocaleString('id-ID')}</td>
            <td class="text-nowrap">${status}</td> 
        </tr>
        `;
    });
}

window.kirimDraftWhatsapp = function () {
    let nama = document.getElementById("cust-name").value;
    let phone = document.getElementById("cust-phone").value;

    if (!nama) {
        showNotification("Nama customer kosong!", "danger");
        return;
    }
    if (!phone) {
        showNotification("Nomor WhatsApp kosong!", "danger");
        return;
    }

    let tagihan = window.kalkulasiTagihan(keranjang);
    let total = tagihan.totalBulat;
    let diskonNominalTagihan = tagihan.diskonNominal;
    let pembulatan = tagihan.pembulatan;

    let dp = parseInt(document.getElementById("payment-dp").value) || 0;
    let sisa = total - dp;
    let waPhone = phone.replace(/^0/, '62').replace(/\D/g, '');

    let itemLines = "";
    keranjang.forEach((i, idx) => {
        let finishingPotong = i.finishingPotong || 0;
        let subtotalProduk = i.subtotal - finishingPotong;
        let hargaSatuanItem = i.qty > 0 ? (subtotalProduk / i.qty) : 0;

        let namaItemLow = (i.nama || "").toLowerCase();
        let apakahKustom = namaItemLow.includes("[kustom]");

        let namaTampilan = i.nama;
        if (apakahKustom) {
            namaTampilan = i.nama.replace(/\[KUSTOM\]/gi, "").trim();
        }

        let adaVarianNyata = i.varian && i.varian.trim() !== "" && i.varian.trim() !== "-";

        let itemSubtotalStr = `Rp ${i.subtotal.toLocaleString('id-ID')}`;

        if (apakahKustom) {
            itemLines += `${idx + 1}. *${namaTampilan}*\n      ${i.qty} x Rp ${hargaSatuanItem.toLocaleString('id-ID')}\n      = ${itemSubtotalStr}\n`;
        } else {
            // Menyusun teks WA secara dinamis berdasarkan ada/tidaknya varian asli
            let teksVarian = adaVarianNyata ? `      Varian: ${i.varian}\n` : '';
            itemLines += `${idx + 1}. *${namaTampilan}*\n${teksVarian}      ${i.qty} x Rp ${hargaSatuanItem.toLocaleString('id-ID')}\n`;

            if (finishingPotong > 0) {
                itemLines += `      + Potong: Rp ${finishingPotong.toLocaleString('id-ID')}\n`;
            }

            itemLines += `      = ${itemSubtotalStr}\n`;
        }
    });

    let subtotalAsli = keranjang.reduce((sum, i) => sum + i.subtotal, 0);
    let diskonNominal = diskonNominalTagihan;
    let diskonText = diskonNominal > 0 ? `Subtotal: Rp ${subtotalAsli.toLocaleString('id-ID')}\nDiskon: -Rp ${diskonNominal.toLocaleString('id-ID')}\n──────────────\n` : '';
    let pembulatanText = pembulatan !== 0 ? `Pembulatan: ${pembulatan > 0 ? '+' : ''}Rp ${Math.abs(pembulatan).toLocaleString('id-ID')}\n` : '';

    let teks = `*RINCIAN PESANAN*\nCustomer: ${nama}\n──────────────\n${itemLines}──────────────\n${diskonText}${pembulatanText}Total: Rp ${total.toLocaleString('id-ID')}\nDP/Tunai: Rp ${dp.toLocaleString('id-ID')}\nSisa Tagihan: Rp ${sisa.toLocaleString('id-ID')}\n──────────────\n${catatanToko}\n`;

    window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(teks)}`, "whatsappWindow");
};

window.editProduk = function (id) {
    const produk = listProduk.find(p => p.id === id);
    if (!produk) return;

    document.getElementById("adm-prod-id").value = produk.id;
    document.getElementById("adm-prod-nama").value = produk.nama;
    document.getElementById("adm-prod-kategori").value = produk.kategori;

    let jenis = produk.jenisLayanan || "pcs";
    if (jenis === "false") jenis = "pcs";
    if (jenis === "true") {
        let namaLow = (produk.nama || "").toLowerCase();
        jenis = (namaLow.includes("banner") || namaLow.includes("spanduk")) ? "meter_min1" : "meter_murni";
    }
    document.getElementById("adm-prod-hitung").value = jenis;

    document.getElementById("adm-prod-harga").value = produk.harga;
    document.getElementById("adm-prod-icon").value = produk.icon || "fa-file-lines";
    document.getElementById("adm-prod-varian").value = (produk.varian || []).join(",");

    // 🎯 SINKRONISASI NILAI GROSIR KE KOTAK INPUT SAAT EDIT KLIK
    if (document.getElementById("adm-prod-grosir-qty")) document.getElementById("adm-prod-grosir-qty").value = produk.grosirQty || 0;
    if (document.getElementById("adm-prod-grosir-harga")) document.getElementById("adm-prod-grosir-harga").value = produk.grosirHarga || 0;
    
    // 📦 STOK FISIK
    if (document.getElementById("adm-prod-stok")) {
        document.getElementById("adm-prod-stok").value = produk.stokFisik !== undefined && produk.stokFisik !== null ? produk.stokFisik : "";
    }

    document.getElementById("admin-form-title").innerHTML = '<i class="fa-solid fa-pen me-2"></i>Edit Produk';
};

// 1. Perbaikan Event Listener Pencarian Admin (Menggunakan nama fungsi yang benar: renderTabelAdminProduk)
document
    .getElementById("search-produk-admin")
    ?.addEventListener(
        "input",
        renderTabelAdminProduk
    );

// 2. Fungsi Simpan PIN Baru — Disimpan ke Firebase (AMAN)
window.simpanPinBaru = async function () {
    const pinBaru = document.getElementById("setting-pin-baru").value.trim();

    if (pinBaru.length < 4) {
        Swal.fire({ icon: 'warning', title: 'Oops...', text: 'PIN minimal 4 digit' });
        return;
    }

    try {
        await set(ref(db, 'settings/pin_owner'), pinBaru);
        // Hapus sisa jejak PIN lama dari localStorage jika ada
        localStorage.removeItem("pin_admin");
        Swal.fire({ icon: 'success', title: 'Berhasil', text: 'PIN berhasil disimpan ke cloud!' });
        document.getElementById("setting-pin-baru").value = "";
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'Gagal', text: 'Gagal menyimpan PIN. Coba lagi.' });
        console.error("Gagal simpan PIN:", err);
    }
};

// ========================================================
// 4. MODUL PREMIUM: EXPORT LAPORAN PERIODE KE EXCEL (.XLS)
// ========================================================
window.exportLaporanKeExcel = function () {
    const inputStart = document.getElementById("report-start-date")?.value || "Awal";
    const inputEnd = document.getElementById("report-end-date")?.value || "Akhir";

    let tabelHTML = `
    <table border="1">
        <tr style="background-color: #15803d; color: #ffffff; font-weight: bold;">
            <th colspan="6" style="font-size: 16px; text-align: center; height: 30px;">LAPORAN OMSET PERCETAKAN PUTRA PRINT</th>
        </tr>
        <tr style="background-color: #f4f4f5;">
            <th colspan="6" style="text-align: center;">Periode Rekap: ${inputStart} s/d ${inputEnd}</th>
        </tr>
        <tr style="background-color: #e4e4e7; font-weight: bold;">
            <th>ID Nota</th>
            <th>Nama Customer</th>
            <th>Rincian Item Cetak</th>
            <th>Total Nota (Rp)</th>
            <th>Omset Masuk / DP (Rp)</th>
            <th>Status Alur Kerja</th>
        </tr>
    `;

    const reportTableBody = document.getElementById("report-table-body");
    if (!reportTableBody || reportTableBody.rows.length === 0 || reportTableBody.rows[0].cells.length === 1) {
        Swal.fire({ icon: 'warning', title: 'Data Kosong', text: 'Tidak ada data transaksi pada rentang tanggal terpilih untuk diexport!' });
        return;
    }

    // Ambil baris data langsung dari layar laporan kasir aktif
    for (let i = 0; i < reportTableBody.rows.length; i++) {
        let row = reportTableBody.rows[i];
        tabelHTML += `
        <tr>
            <td>${row.cells[0].innerText}</td>
            <td>${row.cells[1].innerText}</td>
            <td>${row.cells[2].innerText}</td>
            <td>${row.cells[3].innerText.replace(/[^0-8]/g, "")}</td>
            <td>${row.cells[4].innerText.replace(/[^0-8]/g, "")}</td>
            <td>${row.cells[5].innerText}</td>
        </tr>`;
    }
    tabelHTML += `</table>`;

    // Konversi tabel HTML menjadi file BLOB data Excel berkas unduhan
    const dataBlob = new Blob([tabelHTML], { type: 'application/vnd.ms-excel' });
    const urlUnduh = window.URL.createObjectURL(dataBlob);

    const linkAksi = document.createElement('a');
    linkAksi.download = `Laporan_Omset_PutraPrint_${inputStart}_ke_${inputEnd}.xls`;
    linkAksi.href = urlUnduh;
    linkAksi.click();

    window.URL.revokeObjectURL(urlUnduh);
    showNotification("Laporan Excel Berhasil Diunduh!", "success");
};

// ========================================================
// 5. MODUL PREMIUM: LIVE LINE CHART PENJUALAN CHART.JS
// ========================================================
let instanceChartPutraPrint = null;

function renderVisualGrafik7Hari(dataOmset7Hari) {
    const canvasMedia = document.getElementById("chartPenjualanPutraPrint");
    if (!canvasMedia) return;

    if (instanceChartPutraPrint) {
        instanceChartPutraPrint.destroy();
    }

    const labelTanggalX = Object.keys(dataOmset7Hari);
    const nominalUangY = Object.values(dataOmset7Hari);

    instanceChartPutraPrint = new Chart(canvasMedia, {
        type: 'line',
        data: {
            labels: labelTanggalX,
            datasets: [{
                label: 'Omset Lunas (Rp)',
                data: nominalUangY,
                borderColor: '#3b82f6', // Biru Elegan modern
                backgroundColor: 'rgba(59, 130, 246, 0.05)',
                borderWidth: 3,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: '#3b82f6',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7,
                tension: 0.35, // Lengkungan estetik smooth
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: '#f1f5f9' },
                    ticks: {
                        callback: function (value) { return 'Rp ' + value.toLocaleString('id-ID'); },
                        font: { size: 10, family: 'sans-serif' }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 10 } }
                }
            }
        }
    });
}

// ========================================================
// 📦 SISTEM SELECTIVE INVENTORY: PERINGATAN STOK MENIPIS
// ========================================================
window.renderLowStockWarning = function() {
    const container = document.getElementById("inventory-warning-container");
    if (!container) return;

    let lowStockItems = [];
    if (typeof listProduk !== 'undefined') {
        listProduk.forEach(p => {
            if (p.stokFisik !== undefined && p.stokFisik !== null && p.stokFisik <= 10) {
                lowStockItems.push(p);
            }
        });
    }

    if (lowStockItems.length > 0) {
        let html = `
        <div class="alert alert-danger d-flex align-items-center mb-0 shadow-sm border-0" role="alert" style="border-left: 4px solid #dc3545 !important;">
            <i class="fa-solid fa-triangle-exclamation fa-2x me-3"></i>
            <div>
                <h6 class="alert-heading fw-bold mb-1">Peringatan: Stok Menipis!</h6>
                <div class="small">Beberapa bahan baku/produk sudah mencapai batas minimum stok (&#8804; 10):</div>
                <div class="mt-2 d-flex flex-wrap gap-2">
        `;
        
        lowStockItems.forEach(item => {
            html += `<span class="badge bg-white text-danger border border-danger p-2"><i class="fa-solid fa-box me-1"></i> ${item.nama}: <strong>${item.stokFisik} tersisa</strong></span>`;
        });
        
        html += `</div></div></div>`;
        container.innerHTML = html;
        container.style.display = "block";
    } else {
        container.innerHTML = "";
        container.style.display = "none";
    }
};

// ========================================================
// 6. MODUL PREMIUM: LIVE BAR CHART PRODUK TERLARIS CHART.JS
// ========================================================
let instanceChartProduk = null;

function renderVisualGrafikProduk(dataTopProduk) {
    const canvasMedia = document.getElementById("chartProdukTerlarisPutraPrint");
    if (!canvasMedia) return;

    if (instanceChartProduk) {
        instanceChartProduk.destroy();
    }

    const labelProdukX = dataTopProduk.map(p => p.nama);
    const nominalQtyY = dataTopProduk.map(p => p.qty);

    instanceChartProduk = new Chart(canvasMedia, {
        type: 'bar',
        data: {
            labels: labelProdukX,
            datasets: [{
                label: 'Jumlah Terjual (Qty)',
                data: nominalQtyY,
                // Menggunakan tema warna gradasi modern yang premium
                backgroundColor: [
                    '#4f46e5', // Indigo
                    '#06b6d4', // Cyan
                    '#10b981', // Emerald
                    '#f59e0b', // Amber
                    '#ec4899'  // Pink
                ],
                borderRadius: 6,
                barThickness: 24, // Membuat ukuran batang pas, tidak kebesaran
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: '#f1f5f9' },
                    ticks: {
                        callback: function (value) { return value.toLocaleString('id-ID') + 'x'; },
                        font: { size: 10 }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        font: { size: 10, weight: 'bold' }
                    }
                }
            }
        }
    });
}
// ========================================================
// 🖨️ FITUR CETAK STRUK - FORMAT KASIR UTAMA & ANTI-FREEZE
// ========================================================
window.cetakUlangStruk = function (notaId) {
    // 1. Ambil data transaksi
    let order = null;
    if (typeof masterOrdersCache !== 'undefined' && masterOrdersCache && masterOrdersCache[notaId]) {
        order = masterOrdersCache[notaId];
    } else if (window.allOrdersData && window.allOrdersData[notaId]) {
        order = window.allOrdersData[notaId];
    }

    if (!order) {
        Swal.fire({ icon: 'error', title: 'Oops...', text: 'Data transaksi tidak ditemukan!' });
        return;
    }

    // 2. SOLUSI BUG 2: Gunakan Hidden Iframe agar aplikasi utama TIDAK FREEZE/MACET
    let iframe = document.getElementById("print-iframe");
    if (!iframe) {
        iframe = document.createElement("iframe");
        iframe.setAttribute("id", "print-iframe");
        iframe.style.position = "fixed";
        iframe.style.right = "0";
        iframe.style.bottom = "0";
        iframe.style.width = "0";
        iframe.style.height = "0";
        iframe.style.border = "none";
        document.body.appendChild(iframe);
    }

    // 3. FORMAT NOTA DISAMAKAN PERSIS DENGAN KASIR UTAMA
    let htmlStruk = `
    <html>
    <head>
        <title>Nota #${notaId}</title>
        <style>
            @page { size: 58mm auto; margin: 0; }
            body { 
                font-family: 'Courier New', Courier, monospace; 
                width: 48mm; 
                margin: 4mm 2mm; 
                font-size: 11px; 
                color: #000;
            }
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .fw-bold { font-weight: bold; }
            .line { border-bottom: 1px dashed #000; margin: 6px 0; }
            .header-title { font-size: 13px; font-weight: bold; }
            table { width: 100%; border-collapse: collapse; margin: 2px 0; }
            td { vertical-align: top; font-size: 11px; padding: 1px 0; }
        </style>
    </head>
    <body>
        <div class="text-center">
            <span class="header-title">PUTRA PRINT</span><br>
            <span>Premium POS System</span><br>
            <span style="font-size: 9px; opacity: 0.8;">Surabaya Barat</span>
        </div>
        
        <div class="line"></div>
        
        <table>
            <tr><td>ID NOTA :</td><td class="text-right fw-bold">#${order.notaId || notaId}</td></tr>
            <tr><td>TANGGAL :</td><td class="text-right">${order.tanggal || '-'}</td></tr>
            <tr><td>PELANGGAN:</td><td class="text-right">${order.nama || 'Umum'}</td></tr>
            <tr><td>TELP    :</td><td class="text-right">${order.phone || '-'}</td></tr>
        </table>
        
        <div class="line"></div>
        
        <table>
    `;

    // Looping daftar barang belanjaan cetak
    if (order.item && typeof order.item === 'object') {
        Object.keys(order.item).forEach(k => {
            let item = order.item[k];
            htmlStruk += `
                <tr>
                    <td colspan="2" class="fw-bold">${item.namaProduk || item.nama || "Item Cetak"}</td>
                </tr>
                <tr>
                    <td>&nbsp;&nbsp;${item.qty} x Rp ${(item.harga || 0).toLocaleString('id-ID')}</td>
                    <td class="text-right">Rp ${(item.subtotal || 0).toLocaleString('id-ID')}</td>
                </tr>
            `;
        });
    }

    // Bagian hitungan finansial bawah nota
    htmlStruk += `
        </table>
        
        <div class="line"></div>
        
        <table>
            <tr>
                <td class="fw-bold">TOTAL BELANJA:</td>
                <td class="text-right fw-bold">Rp ${(order.totalBelanja || 0).toLocaleString('id-ID')}</td>
            </tr>
            <tr>
                <td>NOMINAL TERBAYAR:</td>
                <td class="text-right">Rp ${(order.dpMasuk || 0).toLocaleString('id-ID')}</td>
            </tr>
            <tr class="fw-bold">
                <td>SISA TAGIHAN:</td>
                <td class="text-right">Rp ${(order.sisaTagihan || 0).toLocaleString('id-ID')}</td>
            </tr>
        </table>
        
        <div class="line"></div>
        
        <div class="text-center" style="font-size: 9px; margin-top: 8px;">
            Terima Kasih Atas Kunjungan Anda<br>
            Barang yang sudah dibeli<br>
            tidak dapat ditukar/dikembalikan.
        </div>
    </body>
    </html>
    `;

    // 4. SOLUSI BUG 1 & 2: Suntikkan konten ke iframe rahasia lalu picu perintah print otomatis
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(htmlStruk);
    doc.close();

    // Beri jeda 300ms agar browser selesai menyusun teks baru picu print
    setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
    }, 300);
};

// FUNGSI RESET FILTER LAPORAN
window.resetFilterLaporan = function () {
    if (document.getElementById("report-search-input")) document.getElementById("report-search-input").value = "";

    let today = new Date();
    let yyyy = today.getFullYear();
    let mm = String(today.getMonth() + 1).padStart(2, '0');
    let dd = String(today.getDate()).padStart(2, '0');
    let formatHariIni = `${yyyy}-${mm}-${dd}`;

    if (document.getElementById("report-start-date")) document.getElementById("report-start-date").value = formatHariIni;
    if (document.getElementById("report-end-date")) document.getElementById("report-end-date").value = formatHariIni;

    hitungDataDashboardDanLaporan();
};

// 🧠 FUNGSI RESET FILTER REALTIME
window.resetFilterOrderan = function () {
    if (document.getElementById("search-order-dynamic")) document.getElementById("search-order-dynamic").value = "";
    if (document.getElementById("filter-status-order")) document.getElementById("filter-status-order").value = "";
    if (document.getElementById("filter-pembayaran-order")) document.getElementById("filter-pembayaran-order").value = "";

    let today = new Date();
    let yyyy = today.getFullYear();
    let mm = String(today.getMonth() + 1).padStart(2, '0');
    let dd = String(today.getDate()).padStart(2, '0');
    let formatHariIni = `${yyyy}-${mm}-${dd}`;

    if (document.getElementById("filter-tanggal-mulai")) document.getElementById("filter-tanggal-mulai").value = formatHariIni;
    if (document.getElementById("filter-tanggal-selesai")) document.getElementById("filter-tanggal-selesai").value = formatHariIni;

    renderTableAntrean();
};

// ========================================================
// 6. MODUL ANTIGRAVITY: KEYBOARD HOTKEYS (UX INOVASI)
// ========================================================
document.addEventListener('keydown', function (e) {
    // Abaikan pintasan jika sedang mengetik di input text/textarea, KECUALI untuk tombol F (F2, F4, F7)
    const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

    if (e.key === 'F2') {
        e.preventDefault(); // Mencegah fungsi bawaan browser
        const searchInput = document.getElementById('search-product-input');
        if (searchInput) searchInput.focus();
    }
    else if (e.key === 'F4') {
        e.preventDefault();
        if (window.simpanTransaksi) window.simpanTransaksi('PRINT');
    }
    else if (e.key === 'F7') {
        e.preventDefault();
        if (window.setNominalInstan) window.setNominalInstan('pas');
    }
    else if (e.key === 'Escape') {
        // Jangan eksekusi jika ada SweetAlert terbuka
        if (typeof Swal !== 'undefined' && Swal.isVisible()) return;

        // Kosongkan draft hanya jika tidak fokus di input box atau sedang mengetik
        if (keranjang && keranjang.length > 0) {
            Swal.fire({
                title: 'Kosongkan Keranjang?',
                text: "Anda menekan tombol ESC. Seluruh draft order akan dihapus.",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Ya, Kosongkan',
                cancelButtonText: 'Batal'
            }).then((result) => {
                if (result.isConfirmed) {
                    if (window.clearDraftKasir) window.clearDraftKasir();
                }
            });
        }
    }
});

// UI Fungsi Sortir Dinamis Laporan & Dashboard
window.currentLaporanSort = null;
window.currentLaporanDir = "desc";
window.currentDashboardSort = null;
window.currentDashboardDir = "desc";

window.sortLaporan = function (field) {
    if (window.currentLaporanSort === field) {
        window.currentLaporanDir = window.currentLaporanDir === "asc" ? "desc" : "asc";
    } else {
        window.currentLaporanSort = field;
        window.currentLaporanDir = "asc";
    }
    hitungDataDashboardDanLaporan();
    updateSortIcons('report-table-head', field, window.currentLaporanDir);
};

window.sortDashboard = function (field) {
    if (window.currentDashboardSort === field) {
        window.currentDashboardDir = window.currentDashboardDir === "asc" ? "desc" : "asc";
    } else {
        window.currentDashboardSort = field;
        window.currentDashboardDir = "asc";
    }
    hitungDataDashboardDanLaporan();
    updateSortIcons('db-table-head', field, window.currentDashboardDir);
};

window.updateSortIcons = function (theadId, field, dir) {
    const thead = document.getElementById(theadId);
    if (!thead) return;

    // Reset semua icon
    const icons = thead.querySelectorAll('i.fa-sort, i.fa-sort-up, i.fa-sort-down');
    icons.forEach(i => {
        i.className = 'fa-solid fa-sort text-muted ms-1';
    });

    // Update icon yang diklik berdasarkan nama fungsi yg dipanggil
    let onclickStr = '';
    if (theadId === 'report-table-head') {
        onclickStr = `sortLaporan('${field}')`;
    } else if (theadId === 'order-table-head') {
        onclickStr = `sortTableOrder('${field}')`;
    } else if (theadId === 'produk-table-head') {
        onclickStr = `sortTableProduk('${field}')`;
    } else {
        onclickStr = `sortDashboard('${field}')`;
    }
    const th = thead.querySelector(`th[onclick="${onclickStr}"]`);

    if (th) {
        const icon = th.querySelector('i');
        if (icon) {
            icon.className = dir === 'asc' ? 'fa-solid fa-sort-up text-primary ms-1' : 'fa-solid fa-sort-down text-primary ms-1';
        }
    }
};

// ==============================================================================
// 🔐 SISTEM SESI & MANAJEMEN ROLE
// ==============================================================================
window.initUserSession = async function (user) {
    window.currentUserUid = user.uid;
    try {
        const { get, ref: dbRef } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js");
        const snap = await get(dbRef(db, `users/${user.uid}`));
        let userData = snap.exists() ? snap.val() : null;

        // AUTO-MIGRASI OWNER: Jika user belum terdaftar di database 'users', ATAU belum punya 'role', ini pasti akun lama (Owner).
        // Kasir baru akan selalu memiliki data role:'kasir' yang diset saat pembuatan.
        if (!userData || !userData.role) {
            userData = userData || {};
            userData.role = 'owner';
            userData.nama = userData.nama || user.email || 'Owner';
            if (!userData.lastPasswordChange) userData.lastPasswordChange = Date.now();

            // Simpan otomatis ke database
            await update(dbRef(db, `users/${user.uid}`), userData).catch(e => console.error(e));
        }

        window.currentUserRole = userData.role || 'kasir';
        window.currentUserNama = userData.nama || user.email;

        // CEK JIKA AKUN SUDAH DIHAPUS/DINONAKTIFKAN
        if (window.currentUserRole === 'deleted') {
            alert('Akses Ditolak: Akun Anda telah dinonaktifkan oleh Owner.');
            if (window.doLogout) {
                window.doLogout(true); // pass true to skip confirmation
            } else {
                import('./js/auth.js').then(module => {
                    module.logoutUser().then(() => window.location.replace('login.html'));
                });
            }
            return;
        }

        // Update UI Header Info
        const headerUserInfo = document.getElementById('header-user-info');
        if (headerUserInfo) {
            let roleBadge = '<span class="badge bg-secondary">Unknown</span>';
            if (window.currentUserRole === 'owner') roleBadge = '<span class="badge bg-danger">Owner</span>';
            else if (window.currentUserRole === 'kasir') roleBadge = '<span class="badge bg-primary">Kasir</span>';
            else if (window.currentUserRole === 'operator') roleBadge = '<span class="badge bg-info text-dark">Operator</span>';

            headerUserInfo.innerHTML = `<i class="fa-solid fa-user-circle"></i> ${window.currentUserNama} ${roleBadge}`;
        }

        // Update UI Kasir Nama
        const spanNama = document.getElementById('span-nama-kasir-header');
        if (spanNama) spanNama.innerText = window.currentUserNama;

        // Jika owner, tampilkan menu manajemen staf
        if (window.currentUserRole === 'owner') {
            const secStaf = document.getElementById('section-manajemen-staf');
            if (secStaf) secStaf.style.display = 'block';
            window.renderTabelStaf();
        }

        // Cek Peringatan Ganti Password
        const sysSnap = await get(dbRef(db, 'settings/system_policy/passwordChangeIntervalDays'));
        const intervalDays = sysSnap.exists() ? parseInt(sysSnap.val()) : 30; // Default 30 hari

        let lastChange = userData.lastPasswordChange;
        // Jika akun lama (seperti owner) belum memiliki data lastPasswordChange, kita inisialisasi dengan waktu sekarang agar tidak tiba-tiba disuruh ganti password.
        if (!lastChange) {
            lastChange = Date.now();
            update(dbRef(db, `users/${user.uid}`), { lastPasswordChange: lastChange }).catch(e => console.error("Update lastChange error", e));
        }

        const daysSinceChange = (Date.now() - lastChange) / (1000 * 60 * 60 * 24);

        if (intervalDays > 0 && daysSinceChange >= intervalDays) {
            const modalEl = document.getElementById('modalGantiPassword');
            if (modalEl) {
                const modalInst = new bootstrap.Modal(modalEl);
                modalInst.show();
            }
        }

        // Cek Sesi Buka Kasir
        await cekBukaKasir();

    } catch (err) {
        console.error("Gagal inisialisasi sesi:", err);
    }
};

window.tambahStafBaru = async function () {
    const nama = document.getElementById('add-staff-nama').value.trim();
    const pass = document.getElementById('add-staff-pass').value;
    const role = document.getElementById('add-staff-role') ? document.getElementById('add-staff-role').value : 'kasir';
    const msgEl = document.getElementById('add-staff-msg');
    const btn = document.getElementById('btn-tambah-staf');

    if (!nama || pass.length < 6) {
        msgEl.className = 'mt-2 small fw-bold text-center text-danger';
        msgEl.innerText = 'Nama wajib diisi & Password minimal 6 karakter!';
        msgEl.classList.remove('d-none');
        return;
    }

    if (nama.includes(' ')) {
        msgEl.className = 'mt-2 small fw-bold text-center text-danger';
        msgEl.innerText = 'Gunakan satu kata saja (tanpa spasi).';
        msgEl.classList.remove('d-none');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';
    msgEl.classList.add('d-none');

    const res = await registerStaff(nama, pass, role);

    btn.disabled = false;
    btn.innerHTML = 'Daftarkan Akun';

    if (res.success) {
        msgEl.className = 'mt-2 small fw-bold text-center text-success';
        msgEl.innerText = 'Staf berhasil didaftarkan!';
        msgEl.classList.remove('d-none');
        document.getElementById('add-staff-nama').value = '';
        document.getElementById('add-staff-pass').value = '';
    } else {
        msgEl.className = 'mt-2 small fw-bold text-center text-danger';
        msgEl.innerText = 'Gagal: ' + res.error;
        msgEl.classList.remove('d-none');
    }
};

window.renderTabelStaf = function () {
    const tbody = document.getElementById('table-staf-body');
    if (!tbody) return;

    onValue(ref(db, 'users'), (snapshot) => {
        const users = snapshot.val();
        if (!users) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Belum ada staf</td></tr>';
            return;
        }

        let html = '';
        Object.keys(users).forEach(uid => {
            const u = users[uid];
            if (u.role === 'deleted') return; // Sembunyikan staf yang sudah dinonaktifkan

            const dateStr = u.lastPasswordChange ? new Date(u.lastPasswordChange).toLocaleDateString('id-ID') : 'Belum Pernah';
            let roleBadge = '<span class="badge bg-secondary">Unknown</span>';
            let aksiBtn = '';

            if (u.role === 'owner') {
                roleBadge = '<span class="badge bg-danger">Owner</span>';
                aksiBtn = `<span class="text-muted small"><i class="fa-solid fa-shield"></i></span>`;
            } else {
                if (u.role === 'kasir') roleBadge = '<span class="badge bg-primary">Kasir</span>';
                else if (u.role === 'operator') roleBadge = '<span class="badge bg-info text-dark">Operator</span>';
                
                aksiBtn = `<button class="btn btn-sm text-danger border-0 p-1" onclick="hapusStaf('${uid}', '${u.nama}')" title="Nonaktifkan Staf"><i class="fa-solid fa-trash-can"></i></button>`;
            }

            html += `
            <tr>
                <td class="fw-bold">${u.nama || '-'}</td>
                <td class="text-muted">${u.email || '-'}</td>
                <td>${roleBadge}</td>
                <td class="text-muted"><i class="fa-regular fa-clock me-1"></i> ${dateStr}</td>
                <td class="text-center">${aksiBtn}</td>
            </tr>`;
        });
        tbody.innerHTML = html || '<tr><td colspan="5" class="text-center text-muted">Belum ada staf</td></tr>';
    });
};

window.hapusStaf = async function(uid, nama) {
    Swal.fire({
        title: 'Nonaktifkan Staf?',
        text: `Anda yakin ingin menonaktifkan akun staf "${nama}"? Staf ini tidak akan bisa login lagi ke dalam sistem.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Ya, Nonaktifkan!'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                await update(ref(db, `users/${uid}`), { role: 'deleted' });
                Swal.fire('Dinonaktifkan!', `Akun ${nama} telah berhasil dinonaktifkan.`, 'success');
            } catch (e) {
                console.error(e);
                Swal.fire('Gagal', 'Terjadi kesalahan saat menonaktifkan akun', 'error');
            }
        }
    });
};

window.prosesGantiPassword = async function () {
    const passLama = document.getElementById('input-pass-lama').value;
    const passBaru = document.getElementById('input-pass-baru').value;
    const errMsg = document.getElementById('pesan-eror-ganti-pass');
    const btn = document.getElementById('btn-proses-ganti-pass');

    if (!passLama || passBaru.length < 6) {
        errMsg.innerText = "Password baru minimal 6 karakter.";
        errMsg.classList.remove('d-none');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';
    errMsg.classList.add('d-none');

    try {
        const user = auth.currentUser;
        if (!user) throw new Error("Tidak ada user aktif.");

        // Re-authenticate
        const credential = EmailAuthProvider.credential(user.email, passLama);
        await reauthenticateWithCredential(user, credential);

        // Update Password
        await updatePassword(user, passBaru);

        // Update timestamp di database
        await update(ref(db, `users/${user.uid}`), {
            lastPasswordChange: Date.now()
        });

        // Sukses
        const modalEl = document.getElementById('modalGantiPassword');
        const modalInst = bootstrap.Modal.getInstance(modalEl);
        if (modalInst) modalInst.hide();

        showNotification("Password berhasil diperbarui!", "success");

    } catch (error) {
        console.error(error);
        errMsg.innerText = "Gagal! Password lama salah atau koneksi bermasalah.";
        errMsg.classList.remove('d-none');
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Perbarui Sekarang <i class="fa-solid fa-arrow-right ms-1"></i>';
    }
};

window.cekBukaKasir = async function () {
    // Hanya berlaku jika sudah login
    if (!window.currentUserUid) return;

    // Bypass untuk Owner (Owner tidak perlu Buka Kasir)
    if (window.currentUserRole === 'owner') return;

    const tglSekarang = new Date().toISOString().split('T')[0];

    try {
        const snap = await get(ref(db, `daily_sessions/${tglSekarang}`));
        if (!snap.exists()) {
            // Otomatis buka sesi kasir dengan modal awal 0 agar tidak mengganggu kasir saat buka aplikasi
            await set(ref(db, `daily_sessions/${tglSekarang}`), {
                tanggal: tglSekarang,
                modalAwal: 0,
                dibukaOleh: window.currentUserNama || 'Unknown',
                timestamp: Date.now()
            });
            window.sessionModalAwal = 0;
            const ws = document.getElementById('welcome-screen');
            if (ws) ws.style.display = 'none';
        } else {
            const sessionData = snap.val();
            // Simpan modal awal di memori agar bisa dipakai saat tutup kasir pre-fill
            window.sessionModalAwal = sessionData.modalAwal || 0;
        }
    } catch (e) {
        console.error("Gagal cek sesi kasir:", e);
    }
};

window.prosesBukaKasir = async function () {
    let modalAwal = parseInt(document.getElementById("bk-modal-awal").value) || 0;
    const tglSekarang = new Date().toISOString().split('T')[0];

    try {
        await set(ref(db, `daily_sessions/${tglSekarang}`), {
            tanggal: tglSekarang,
            modalAwal: modalAwal,
            dibukaOleh: window.currentUserNama || 'Unknown',
            timestamp: Date.now()
        });

        window.sessionModalAwal = modalAwal;

        const ws = document.getElementById('welcome-screen');
        if (ws) ws.style.display = 'none';

        Swal.fire({
            title: 'Sesi Dimulai',
            text: 'Selamat bertugas! Laci kasir telah dibuka.',
            icon: 'success',
            timer: 1500,
            showConfirmButton: false
        });

    } catch (e) {
        Swal.fire("Gagal", "Tidak dapat membuka sesi kasir. Cek koneksi Anda.", "error");
    }
};