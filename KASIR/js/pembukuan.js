import { ref, set, onValue, update, remove, get, push } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { db, auth } from "./firebase-init.js";

let masterOrdersCache = {};
onValue(ref(db, 'orders'), (snapshot) => {
    masterOrdersCache = snapshot.exists() ? snapshot.val() : {};
    if (typeof window.renderDataKeuangan === 'function') window.renderDataKeuangan();
});

// =========================================================

// =========================================================
// INIT SESSION KHUSUS PEMBUKUAN
// =========================================================
auth.onAuthStateChanged(async user => {
    if (user) {
        window.currentUserUid = user.uid;
        try {
            const snap = await get(ref(db, 'users/' + user.uid));
            let userData = snap.exists() ? snap.val() : null;
            if (!userData || !userData.role) {
                userData = { role: 'owner', nama: user.email || 'Owner' };
            }
            window.currentUserRole = userData.role || 'kasir';
            window.currentUserNama = userData.nama || user.email;
            
            if(typeof window.renderDataKeuangan === 'function') {
                window.renderDataKeuangan();
            }
        } catch(e) {
            console.error('Error auth listener pembukuan:', e);
        }
    }
});

// MODUL KEUANGAN & TUTUP KASIR (END OF DAY)
// =========================================================

window.kembaliKeKeuangan = function() {
    window.tampilkanPanelPembukuan('panel-keuangan');
};

window.tampilkanPanelPembukuan = function(panelId) {
    document.querySelectorAll('.tab-pane-custom').forEach(tab => {
        if(tab.id === 'panel-kasir') return; // abaikan jika ada di pembukuan
        tab.style.display = 'none';
        tab.classList.remove('active');
    });
    const p = document.getElementById(panelId);
    if(p) {
        p.style.display = 'block';
        p.classList.add('active');
    }
};

window.bukaModalPengeluaran = async function() {
    document.getElementById("pengeluaran-nominal").value = "";
    document.getElementById("pengeluaran-keterangan").value = "";
    const listEl = document.getElementById("list-pengeluaran-hari-ini");
    listEl.innerHTML = '<div class="text-center text-muted py-3"><i class="fa-solid fa-spinner fa-spin"></i> Memuat...</div>';
    
    window.tampilkanPanelPembukuan('panel-pengeluaran');

    // Fetch riwayat hari ini
    const tglSekarang = new Date().toISOString().split('T')[0];
    try {
        const snap = await get(ref(db, 'cash_expenses'));
        if (snap.exists()) {
            const expenses = snap.val();
            let html = '';
            Object.values(expenses).forEach(exp => {
                if (exp.tanggal === tglSekarang) {
                    html += `
                    <div class="d-flex justify-content-between border-bottom py-2">
                        <div>
                            <div class="fw-bold">${exp.keterangan}</div>
                            <small class="text-muted"><i class="fa-solid fa-user me-1"></i>${exp.kasir}</small>
                        </div>
                        <div class="text-danger fw-bold">- Rp ${exp.nominal.toLocaleString('id-ID')}</div>
                    </div>`;
                }
            });
            listEl.innerHTML = html || '<div class="text-center text-muted py-3">Belum ada pengeluaran hari ini.</div>';
        } else {
            listEl.innerHTML = '<div class="text-center text-muted py-3">Belum ada pengeluaran hari ini.</div>';
        }
    } catch(e) {
        listEl.innerHTML = '<div class="text-center text-danger py-3">Gagal memuat data.</div>';
    }
};

window.simpanPengeluaranKas = async function() {
    let nominal = parseInt(document.getElementById("pengeluaran-nominal").value) || 0;
    let keterangan = document.getElementById("pengeluaran-keterangan").value.trim();
    
    if (nominal <= 0 || !keterangan) {
        Swal.fire("Data Tidak Valid", "Pastikan nominal dan keterangan pengeluaran sudah diisi dengan benar.", "warning");
        return;
    }

    const tglSekarang = new Date().toISOString().split('T')[0]; // Format YYYY-MM-DD
    const expenseId = "EXP-" + Date.now();
    
    const data = {
        id: expenseId,
        tanggal: tglSekarang,
        timestamp: Date.now(),
        nominal: nominal,
        keterangan: keterangan,
        kasir: window.currentUserNama || 'Unknown'
    };

    try {
        await set(ref(db, `cash_expenses/${expenseId}`), data);
        Swal.fire("Berhasil", "Pengeluaran Kas berhasil dicatat!", "success").then(() => {
            window.kembaliKeKeuangan();
            if (typeof window.renderDataKeuangan === 'function') window.renderDataKeuangan();
        });
        
    } catch (e) {
        console.error(e);
        Swal.fire("Gagal", "Gagal menyimpan data pengeluaran.", "error");
    }
};

window.editModalAwalManual = function() {
    Swal.fire({
        title: 'Atur Modal Awal',
        input: 'number',
        inputLabel: 'Masukkan nominal uang modal awal (kembalian) di laci',
        inputPlaceholder: 'Contoh: 100000',
        inputValue: window.sessionModalAwal || 0,
        showCancelButton: true,
        confirmButtonText: 'Simpan',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#3085d6'
    }).then(async (result) => {
        if (result.isConfirmed) {
            let nominal = parseInt(result.value) || 0;
            const tglSekarang = new Date().toISOString().split('T')[0];
            
            try {
                await update(ref(db, `daily_sessions/${tglSekarang}`), {
                    modalAwal: nominal,
                    diupdateOleh: window.currentUserNama || 'Kasir'
                });
                
                window.sessionModalAwal = nominal;
                Swal.fire('Tersimpan!', `Modal Awal berhasil diubah menjadi Rp ${nominal.toLocaleString('id-ID')}`, 'success');
                
                if (typeof window.renderDataKeuangan === 'function') window.renderDataKeuangan();
            } catch(e) {
                console.error(e);
                Swal.fire('Gagal', 'Tidak dapat menyimpan modal awal ke database.', 'error');
            }
        }
    });
};
window.bukaModalTutupKasir = async function() {
    const tglSekarang = new Date().toISOString().split('T')[0];
    const kasirNama = window.currentUserNama || 'Kasir';
    
    // Cek apakah sudah pernah tutup kasir hari ini
    try {
        const snap = await get(ref(db, 'daily_reports'));
        if (snap.exists()) {
            let reports = Object.values(snap.val());
            let alreadyClosed = reports.find(r => r.tanggal === tglSekarang && r.kasir === kasirNama);
            if (alreadyClosed) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Sudah Tutup Kasir!',
                    html: `Anda (<b>${kasirNama}</b>) sudah melakukan tutup kasir hari ini.<br><br><b>Ada pelanggan telat (tambahan transaksi)?</b><br>Jika Anda melanjutkan, laporan sebelumnya akan <b>ditimpa (diupdate)</b> dengan total yang baru agar pembukuan tidak ganda.`,
                    showCancelButton: true,
                    confirmButtonText: 'Ya, Update Laporan',
                    cancelButtonText: 'Batal',
                    confirmButtonColor: '#d33'
                }).then((result) => {
                    if (result.isConfirmed) {
                        window.tutupKasirExistingId = alreadyClosed.id; // Simpan ID lama untuk ditimpa
                        lanjutBukaModalTutupKasir(tglSekarang);
                    }
                });
                return; // Stop eksekusi dan tunggu konfirmasi
            }
        }
    } catch(e) {
        console.error("Error cek tutup kasir:", e);
    }
    
    window.tutupKasirExistingId = null; // Reset jika buat baru
    lanjutBukaModalTutupKasir(tglSekarang);
};

window.lanjutBukaModalTutupKasir = async function(tglSekarang) {
    let masukTunai = 0;
    let masukNonCash = 0;
    let keluarKas = 0;

    // 1. Hitung Pemasukan Transaksi (Dari Orders Hari Ini)
    // Ingat, kita butuh order_tanggal yang cocok dengan format "tanggal" di orders
    const dateObj = new Date();
    const daftarBulan = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    let tglOrderFormat = `${dateObj.getDate()} ${daftarBulan[dateObj.getMonth()]} ${dateObj.getFullYear()}`;

    Object.values(masterOrdersCache).forEach(order => {
        if (order.tanggal === tglOrderFormat) {
            let dp = order.dpMasuk || 0;
            let method = order.paymentMethod || 'Tunai'; // Default lama = Tunai
            if (method === 'Tunai') {
                masukTunai += dp;
            } else {
                masukNonCash += dp;
            }
        }
    });

    // 2. Hitung Pengeluaran Kas
    try {
        const snap = await get(ref(db, 'cash_expenses'));
        if (snap.exists()) {
            const expenses = snap.val();
            Object.values(expenses).forEach(exp => {
                if (exp.tanggal === tglSekarang) {
                    keluarKas += (exp.nominal || 0);
                }
            });
        }
    } catch(e) {
        console.error("Error reading expenses:", e);
    }

    // Update UI SPA
    document.getElementById("tk-modal-awal-label").innerText = `Rp ${(window.sessionModalAwal || 0).toLocaleString('id-ID')}`;
    document.getElementById("tk-penerimaan-label").innerText = `Rp ${(masukTunai + masukNonCash).toLocaleString('id-ID')}`;
    document.getElementById("tk-pengeluaran-label").innerText = `- Rp ${keluarKas.toLocaleString('id-ID')}`;
    
    let uangSistem = (window.sessionModalAwal || 0) + masukTunai + masukNonCash - keluarKas;
    document.getElementById("tk-uang-sistem-label").innerText = `Rp ${uangSistem.toLocaleString('id-ID')}`;

    // Simpan hitungan dasar di memori window agar hitungSelisihKasir bisa pakai
    window.tutupKasirData = {
        modalAwal: window.sessionModalAwal || 0,
        masukTunai, masukNonCash, keluarKas, uangSistem
    };

    // Isi otomatis uang fisik sesuai nominal sistem
    document.getElementById("tk-uang-fisik").value = uangSistem.toLocaleString('id-ID');

    // Hitung Seharusnya
    window.hitungSelisihKasir();

    window.tampilkanPanelPembukuan('panel-tutup-kasir');
};

window.hitungSelisihKasir = function() {
    if (!window.tutupKasirData) return;
    
    let inputStr = document.getElementById("tk-uang-fisik").value || "0";
    let fisik = parseInt(inputStr.replace(/\D/g, '')) || 0;
    let seharusnya = window.tutupKasirData.uangSistem;
    let selisih = fisik - seharusnya;

    let selisihEl = document.getElementById("tk-selisih-label");
    if (selisih > 0) {
        selisihEl.innerText = `+ Rp ${selisih.toLocaleString('id-ID')}`;
        selisihEl.style.color = "var(--emerald)"; // Lebih (Hijau)
    } else if (selisih < 0) {
        selisihEl.innerText = `- Rp ${Math.abs(selisih).toLocaleString('id-ID')}`;
        selisihEl.style.color = "var(--rose)"; // Kurang (Merah)
    } else {
        selisihEl.innerText = `PAS (Rp 0)`;
        selisihEl.style.color = "#000";
    }
};

window.prosesTutupKasirAkhir = async function() {
    if (!window.tutupKasirData) return;
    let modalAwal = window.tutupKasirData.modalAwal;
    let inputStr = document.getElementById("tk-uang-fisik").value || "0";
    let fisik = parseInt(inputStr.replace(/\D/g, '')) || 0;
    let seharusnya = window.tutupKasirData.uangSistem;
    let selisih = fisik - seharusnya;

    const tglSekarang = new Date().toISOString().split('T')[0];
    
    // Ganti ID dengan ID lama jika ini adalah update laporan
    const reportId = window.tutupKasirExistingId || "REP-" + Date.now();
    const kasirNama = window.currentUserNama || 'Kasir';
    
    const reportData = {
        id: reportId,
        tanggal: tglSekarang,
        timestamp: Date.now(),
        kasir: kasirNama,
        modalAwal: modalAwal,
        masukTunai: window.tutupKasirData.masukTunai,
        masukNonCash: window.tutupKasirData.masukNonCash,
        keluarKas: window.tutupKasirData.keluarKas,
        uangFisik: fisik,
        selisih: selisih
    };

    // 1. Simpan Laporan ke Database
    try {
        await set(ref(db, `daily_reports/${reportId}`), reportData);
        
        // 2. Siapkan Teks WA untuk Owner
        let selisihText = selisih < 0 ? '(MINUS)' : selisih > 0 ? '(LEBIH)' : '(PAS)';
        let nowWA = new Date();
        let teksWA = `(${nowWA.toLocaleDateString('id-ID')} ${nowWA.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })})\n` +
                     `Kasir: ${kasirNama}\n\n` +
                     `Modal Awal: Rp ${modalAwal.toLocaleString('id-ID')}\n` +
                     `Masuk (Tunai): Rp ${window.tutupKasirData.masukTunai.toLocaleString('id-ID')}\n` +
                     `Masuk (TF/QR): Rp ${window.tutupKasirData.masukNonCash.toLocaleString('id-ID')}\n` +
                     `Pengeluaran: -Rp ${window.tutupKasirData.keluarKas.toLocaleString('id-ID')}\n` +
                     `------------------------\n` +
                     `*Total:* Rp ${seharusnya.toLocaleString('id-ID')}`;

        // 3. Ambil nomor WA Owner dari pengaturan toko (asumsi owner menggunakan nomor yg terdaftar di toko)
        const waTokoLive = document.getElementById("set-wa-toko")?.value || "083112347800";
        let noWA = waTokoLive.replace(/^0/, '62').replace(/\D/g, '');
        
        // Buka Tab WA
        window.open(`https://wa.me/${noWA}?text=${encodeURIComponent(teksWA)}`, '_blank');
        
        // 4. CETAK LAPORAN KE PRINTER THERMAL
        window.cetakLaporanShift(reportData);
        
        // Sembunyikan Panel SPA & Balik Ke Keuangan
        window.kembaliKeKeuangan();
        
        Swal.fire("Laporan Tersimpan!", "Data tutup kasir berhasil disimpan, dicetak, & draf WA telah dibuat.", "success");
        
    } catch(e) {
        console.error("Error dari prosesTutupKasirAkhir:", e);
        Swal.fire("Gagal", `Laporan gagal disimpan ke database.<br><br><b>Pesan Error:</b> ${e.message}`, "error");
    }
};

// ==========================================
// FUNGSI CETAK LAPORAN TUTUP KASIR
// ==========================================
window.cetakLaporanShift = function(reportData) {
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

    let selisihText = reportData.selisih < 0 ? '(MINUS)' : reportData.selisih > 0 ? '(LEBIH)' : '(PAS)';
    let seharusnya = reportData.modalAwal + reportData.masukTunai + reportData.masukNonCash - reportData.keluarKas;

    let htmlStruk = `
    <html>
    <head>
        <title>Laporan Shift</title>
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
            <span style="font-size:10px;">LAPORAN TUTUP KASIR</span>
        </div>
        
        <div class="line"></div>
        
        <table>
            <tr><td>WAKTU :</td><td class="text-right">${new Date(reportData.timestamp).toLocaleDateString('id-ID')} ${new Date(reportData.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</td></tr>
            <tr><td>KASIR :</td><td class="text-right">${reportData.kasir.substring(0,12)}</td></tr>
        </table>
        
        <div class="line"></div>
        
        <table>
            <tr><td>M.Awal</td><td class="text-right">Rp ${reportData.modalAwal.toLocaleString('id-ID')}</td></tr>
            <tr><td>Tunai</td><td class="text-right">Rp ${reportData.masukTunai.toLocaleString('id-ID')}</td></tr>
            <tr><td>TF/QR</td><td class="text-right">Rp ${reportData.masukNonCash.toLocaleString('id-ID')}</td></tr>
            <tr><td>Keluar</td><td class="text-right">-Rp ${reportData.keluarKas.toLocaleString('id-ID')}</td></tr>
        </table>

        <div class="line"></div>
        
        <table>
            <tr class="fw-bold"><td>Total</td><td class="text-right">Rp ${seharusnya.toLocaleString('id-ID')}</td></tr>
        </table>
        
        <div class="text-center" style="font-size: 9px; margin-top: 15px;">
            Sistem Kasir Putra Print
        </div>
    </body>
    </html>
    `;

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(htmlStruk);
    doc.close();

    setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
    }, 300);
};

window.renderDataKeuangan = async function() {
    window.refreshSesiKasirUI && window.refreshSesiKasirUI(); // Refresh ringkasan sesi kasir
    
    const type = document.getElementById("fin-filter-type").value;
    const startDate = document.getElementById("fin-start-date").value;
    const endDate = document.getElementById("fin-end-date").value;
    
    const tableHead = document.getElementById("fin-table-head");
    const tableBody = document.getElementById("fin-table-body");
    const statCards = document.getElementById("fin-stat-cards");
    const title = document.getElementById("fin-table-title");
    const isOwner = window.currentUserRole === 'owner';

    tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-4"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>';

    try {
        if (type === 'expenses') {
            title.innerHTML = '<i class="fa-solid fa-money-bill-transfer"></i> Daftar Pengeluaran Kas';
            tableHead.innerHTML = `
                <tr>
                    <th>Tanggal</th>
                    <th>Keterangan</th>
                    <th>Kasir</th>
                    <th class="text-end">Nominal</th>
                    ${isOwner ? '<th class="text-center">Aksi</th>' : ''}
                </tr>
            `;
            statCards.style.display = 'flex';
            
            const snap = await get(ref(db, 'cash_expenses'));
            if (!snap.exists()) {
                tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Belum ada data pengeluaran.</td></tr>';
                document.getElementById("fin-total-expense").innerText = 'Rp 0';
                document.getElementById("fin-total-count").innerText = '0 Data';
                return;
            }

            let expenses = Object.values(snap.val());
            let filtered = expenses.filter(exp => {
                let d = exp.tanggal; // YYYY-MM-DD
                if (startDate && d < startDate) return false;
                if (endDate && d > endDate) return false;
                return true;
            });

            // Sort newest first
            filtered.sort((a,b) => b.timestamp - a.timestamp);

            let total = 0;
            let html = '';
            filtered.forEach(exp => {
                total += exp.nominal;
                html += `
                <tr>
                    <td>${exp.tanggal}</td>
                    <td class="fw-bold">${exp.keterangan}</td>
                    <td><i class="fa-solid fa-user me-1 text-muted"></i>${exp.kasir}</td>
                    <td class="text-end text-danger fw-bold">- Rp ${exp.nominal.toLocaleString('id-ID')}</td>
                    ${isOwner ? `<td class="text-center">
                        <button class="btn btn-outline-danger btn-sm" onclick="hapusPengeluaranKas('${exp.id}')"><i class="fa-solid fa-trash"></i></button>
                    </td>` : ''}
                </tr>`;
            });

            if(filtered.length === 0) html = '<tr><td colspan="5" class="text-center py-4 text-muted">Tidak ada data di periode ini.</td></tr>';
            tableBody.innerHTML = html;
            if(document.getElementById("fin-total-expense")) {
                document.getElementById("fin-total-expense").innerText = `Rp ${total.toLocaleString('id-ID')}`;
                let sm = document.getElementById("fin-total-expense").parentElement.querySelector('small');
                if(sm) sm.innerText = "TOTAL PENGELUARAN (TERFILTER)";
            }
            if(document.getElementById("fin-total-count")) {
                document.getElementById("fin-total-count").innerText = `${filtered.length} Data`;
                let sm = document.getElementById("fin-total-count").parentElement.querySelector('small');
                if(sm) sm.innerText = "JUMLAH TRANSAKSI (TERFILTER)";
            }

        } else if (type === 'reports') {
            title.innerHTML = '<i class="fa-solid fa-file-invoice-dollar"></i> Riwayat Laporan Tutup Kasir';
            tableHead.innerHTML = `
                <tr>
                    <th>Tanggal</th>
                    <th>Kasir</th>
                    <th class="text-end">Total Pendapatan Sistem</th>
                    <th class="text-center">Status Laci</th>
                    <th class="text-center">Detail</th>
                </tr>
            `;
            statCards.style.display = 'none';

            const snap = await get(ref(db, 'daily_reports'));
            if (!snap.exists()) {
                tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Belum ada riwayat tutup kasir.</td></tr>';
                return;
            }

            let reports = Object.values(snap.val());
            let filtered = reports.filter(rep => {
                let d = rep.tanggal;
                if (startDate && d < startDate) return false;
                if (endDate && d > endDate) return false;
                return true;
            });

            filtered.sort((a,b) => b.timestamp - a.timestamp);

            let html = '';
            filtered.forEach(rep => {
                let totalSistem = rep.modalAwal + rep.masukTunai + rep.masukNonCash - rep.keluarKas;
                let statusBadge = rep.selisih === 0 ? '<span class="badge bg-success">PAS</span>' : 
                                 (rep.selisih > 0 ? `<span class="badge bg-warning text-dark">+ Rp ${rep.selisih.toLocaleString('id-ID')}</span>` : 
                                                    `<span class="badge bg-danger">- Rp ${Math.abs(rep.selisih).toLocaleString('id-ID')}</span>`);
                html += `
                <tr>
                    <td>${rep.tanggal}</td>
                    <td class="fw-bold">${rep.kasir}</td>
                    <td class="text-end fw-bold">Rp ${totalSistem.toLocaleString('id-ID')}</td>
                    <td class="text-center">${statusBadge}</td>
                    <td class="text-center">
                        <button class="btn btn-primary btn-sm" onclick="lihatDetailReport('${rep.id}')">Lihat</button>
                    </td>
                </tr>`;
            });
            
            if(filtered.length === 0) html = '<tr><td colspan="5" class="text-center py-4 text-muted">Tidak ada data di periode ini.</td></tr>';
            tableBody.innerHTML = html;
        } else if (type === 'piutang') {
            title.innerHTML = '<i class="fa-solid fa-hand-holding-dollar"></i> Buku Piutang (Belum Lunas)';
            tableHead.innerHTML = `
                <tr>
                    <th>Nota / Tgl</th>
                    <th>Pelanggan</th>
                    <th class="text-end">Total Belanja</th>
                    <th class="text-end">DP/Masuk</th>
                    <th class="text-end text-danger">Sisa Tagihan</th>
                    <th class="text-center">Aksi</th>
                </tr>
            `;
            statCards.style.display = 'flex';
            
            // Mengambil dari masterOrdersCache untuk sinkronisasi realtime
            let orders = Object.values(masterOrdersCache || {});
            
            let filtered = orders.filter(o => o.sisaTagihan > 0 && o.status !== "CANCEL");
            
            // Format tanggal o.tanggal yang teks ("26 Jun 2026") agak repot difilter pakai YYYY-MM-DD
            // Jadi filter tanggal kita matikan saja untuk piutang (tampilkan semua piutang yang nyangkut)
            
            filtered.sort((a,b) => String(b.notaId || '').localeCompare(String(a.notaId || ''))); // Sort by ID descending (newest)
            
            let totalPiutang = 0;
            let html = '';
            filtered.forEach(o => {
                totalPiutang += (Number(o.sisaTagihan) || 0);
                
                let namaPelanggan = o.nama || 'Kak';
                let nominalTagihan = (Number(o.sisaTagihan) || 0).toLocaleString('id-ID');
                
                let rawText = `Halo Kak ${namaPelanggan} 🙏\n\nSekadar mengingatkan, pesanan Kakak di Putra Print (Nota #${o.notaId}) masih ada tagihan sebesar *Rp ${nominalTagihan}*.\n\nMohon bantuannya untuk pelunasan ya Kak. Jika sudah dibayar, silakan abaikan pesan ini. Terima kasih! 😊`;
                
                let waText = encodeURIComponent(rawText);
                
                // Format nomor HP ke 62
                let noHp = o.phone || '';
                if (noHp.startsWith('0')) {
                    noHp = '62' + noHp.substring(1);
                } else if (noHp.startsWith('+62')) {
                    noHp = '62' + noHp.substring(3);
                }
                
                let waLink = `https://wa.me/${noHp}?text=${waText}`;
                
                html += `
                <tr>
                    <td>
                        <div class="fw-bold">#${o.notaId}</div>
                        <small class="text-muted">${o.tanggal}</small>
                    </td>
                    <td class="fw-bold">${o.nama} <br><small class="text-muted">${o.phone || '-'}</small></td>
                    <td class="text-end">Rp ${(Number(o.totalBelanja) || 0).toLocaleString('id-ID')}</td>
                    <td class="text-end text-success">Rp ${(Number(o.dpMasuk) || 0).toLocaleString('id-ID')}</td>
                    <td class="text-end text-danger fw-bold">Rp ${(Number(o.sisaTagihan) || 0).toLocaleString('id-ID')}</td>
                    <td class="text-center">
                        <a href="${waLink}" target="_blank" class="btn btn-sm btn-success fw-bold"><i class="fa-brands fa-whatsapp"></i> Tagih</a>
                    </td>
                </tr>`;
            });
            
            if(filtered.length === 0) html = '<tr><td colspan="6" class="text-center py-4 text-muted">Bagus! Tidak ada piutang yang nyangkut.</td></tr>';
            tableBody.innerHTML = html;
            
            if(document.getElementById("fin-total-expense")) {
                document.getElementById("fin-total-expense").innerText = `Rp ${totalPiutang.toLocaleString('id-ID')}`;
                let sm = document.getElementById("fin-total-expense").parentElement.querySelector('small');
                if (sm) sm.innerText = "TOTAL PIUTANG PELANGGAN";
            }
            if(document.getElementById("fin-total-count")) {
                document.getElementById("fin-total-count").innerText = `${filtered.length} Nota`;
                let sm = document.getElementById("fin-total-count").parentElement.querySelector('small');
                if (sm) sm.innerText = "JUMLAH NOTA BELUM LUNAS";
            }
        }

    } catch(e) {
        console.error("Error render keuangan:", e);
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-danger">Gagal memuat data keuangan.</td></tr>';
    }
};

window.refreshSesiKasirUI = async function() {
    const tglSekarang = new Date().toISOString().split('T')[0];
    
    try {
        const snapSesi = await get(ref(db, `daily_sessions/${tglSekarang}`));
        const badgeStatus = document.getElementById('shift-status-badge');
        let modalAwal = 0;
        
        if (snapSesi.exists()) {
            modalAwal = snapSesi.val().modalAwal || 0;
            window.sessionModalAwal = modalAwal; // SINKRONISASI KE VARIABEL GLOBAL AGAR TIDAK HILANG SAAT TUTUP KASIR
            if(badgeStatus) {
                badgeStatus.className = "badge bg-success rounded-pill px-3 py-2";
                badgeStatus.innerHTML = '<i class="fa-solid fa-check-circle me-1"></i> Shift Buka';
            }
        } else {
            if(badgeStatus) {
                badgeStatus.className = "badge bg-danger rounded-pill px-3 py-2";
                badgeStatus.innerHTML = '<i class="fa-solid fa-times-circle me-1"></i> Shift Tutup / Belum Buka';
            }
        }

        // Hitung Omset Tunai & Non-Tunai (Masuk)
        let masukTunai = 0;
        let masukTF = 0;
        let masukQR = 0;
        const dateObj = new Date();
        const daftarBulan = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
        let tglOrderFormat = `${dateObj.getDate()} ${daftarBulan[dateObj.getMonth()]} ${dateObj.getFullYear()}`;
        
        Object.values(masterOrdersCache).forEach(order => {
            if (order.tanggal === tglOrderFormat) {
                let dp = order.dpMasuk || 0;
                let method = order.paymentMethod || 'Tunai';
                if (method === 'Tunai') masukTunai += dp;
                else if (method === 'TF') masukTF += dp;
                else if (method === 'QR') masukQR += dp;
            }
        });

        // Hitung Pengeluaran Kas
        let keluarKas = 0;
        const snapExp = await get(ref(db, 'cash_expenses'));
        if (snapExp.exists()) {
            Object.values(snapExp.val()).forEach(exp => {
                if (exp.tanggal === tglSekarang) keluarKas += (exp.nominal || 0);
            });
        }

        let saldoLaci = modalAwal + masukTunai - keluarKas;

        if (document.getElementById('shift-modal-awal')) document.getElementById('shift-modal-awal').innerText = `Rp ${modalAwal.toLocaleString('id-ID')}`;
        if (document.getElementById('shift-pemasukan')) document.getElementById('shift-pemasukan').innerText = `Rp ${masukTunai.toLocaleString('id-ID')}`;
        if (document.getElementById('shift-pemasukan-tf')) document.getElementById('shift-pemasukan-tf').innerText = `Rp ${masukTF.toLocaleString('id-ID')}`;
        if (document.getElementById('shift-pemasukan-qr')) document.getElementById('shift-pemasukan-qr').innerText = `Rp ${masukQR.toLocaleString('id-ID')}`;
        if (document.getElementById('shift-pengeluaran')) document.getElementById('shift-pengeluaran').innerText = `Rp ${keluarKas.toLocaleString('id-ID')}`;
        if (document.getElementById('shift-saldo-laci')) document.getElementById('shift-saldo-laci').innerText = `Rp ${saldoLaci.toLocaleString('id-ID')}`;
        
    } catch(e) {
        console.error("Error refresh sesi kasir:", e);
    }
};

window.resetFilterKeuangan = function() {
    document.getElementById("fin-start-date").value = "";
    document.getElementById("fin-end-date").value = "";
    renderDataKeuangan();
};

window.hapusPengeluaranKas = function(id) {
    if (window.currentUserRole !== 'owner') {
        Swal.fire('Akses Ditolak', 'Hanya Owner yang berhak menghapus catatan pengeluaran.', 'error');
        return;
    }
    Swal.fire({
        title: 'Hapus Catatan?',
        text: "Data pengeluaran akan dihapus permanen!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Ya, Hapus!'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                await remove(ref(db, `cash_expenses/${id}`));
                Swal.fire('Terhapus!', 'Data berhasil dihapus.', 'success');
                renderDataKeuangan();
            } catch(e) {
                Swal.fire('Gagal', 'Terjadi kesalahan sistem.', 'error');
            }
        }
    });
};

window.lihatDetailReport = async function(id) {
    try {
        const snap = await get(ref(db, `daily_reports/${id}`));
        if (snap.exists()) {
            const rep = snap.val();
            // Format tanggal (H/B/T) dan Jam
            let dateParts = rep.tanggal.split('-'); // asumsi YYYY-MM-DD
            let formattedDate = rep.tanggal;
            let timeStr = "";
            if (rep.timestamp) {
                let d = new Date(rep.timestamp);
                timeStr = " " + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            }
            if(dateParts.length === 3) {
                formattedDate = `${parseInt(dateParts[2])}/${parseInt(dateParts[1])}/${dateParts[0]}${timeStr}`;
            } else {
                formattedDate += timeStr;
            }
            let total = rep.modalAwal + rep.masukTunai + rep.masukNonCash - rep.keluarKas;
            
            Swal.fire({
                html: `
                <div class="text-start" style="font-size:1.1rem; line-height: 1.5; font-family: monospace, sans-serif;">
                    (${formattedDate})<br>
                    Kasir: ${rep.kasir}<br><br>
                    Modal Awal: Rp ${rep.modalAwal.toLocaleString('id-ID')}<br>
                    Masuk (Tunai): Rp ${rep.masukTunai.toLocaleString('id-ID')}<br>
                    Masuk (TF/QR): Rp ${rep.masukNonCash.toLocaleString('id-ID')}<br>
                    Pengeluaran: -Rp ${rep.keluarKas.toLocaleString('id-ID')}<br>
                    ------------------------<br>
                    <b>*Total:* Rp ${total.toLocaleString('id-ID')}</b>
                </div>`,
                confirmButtonText: 'Tutup'
            });
        }
    } catch(e) {}
};

