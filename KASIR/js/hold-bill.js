// ==============================================================================
// FITUR KENYAMANAN: TAHAN BILL (HOLD CART)
// ==============================================================================

window.tahanKeranjang = async function() {
    let keranjang = window.getKeranjang ? window.getKeranjang() : [];
    // Pastikan ada item di keranjang
    if (!keranjang || keranjang.length === 0) {
        Swal.fire("Keranjang Kosong", "Tidak ada pesanan yang bisa ditahan.", "info");
        return;
    }

    const customerNama = document.getElementById("cust-name")?.value || "";
    
    const { value: namaPenahan } = await Swal.fire({
        title: 'Tahan Pesanan',
        text: 'Masukkan nama/keterangan untuk pesanan ini:',
        input: 'text',
        inputValue: customerNama,
        showCancelButton: true,
        confirmButtonText: 'Tahan Bill',
        cancelButtonText: 'Batal',
        inputValidator: (value) => {
            if (!value) {
                return 'Nama/Keterangan tidak boleh kosong!'
            }
        }
    });

    if (namaPenahan) {
        const holdData = {
            id: Date.now().toString(),
            nama: namaPenahan,
            phone: document.getElementById("cust-phone")?.value || "",
            dp: document.getElementById("payment-dp")?.value || 0,
            keranjang: JSON.parse(JSON.stringify(keranjang)),
            waktu: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
        };

        // Simpan ke localStorage
        let savedHolds = JSON.parse(localStorage.getItem('hold_bills_putra_print') || '[]');
        savedHolds.push(holdData);
        localStorage.setItem('hold_bills_putra_print', JSON.stringify(savedHolds));

        // Kosongkan keranjang saat ini
        window.setKeranjang([]);
        if (typeof window.renderKeranjangGlobal === 'function') window.renderKeranjangGlobal();
        document.getElementById("cust-name").value = "";
        document.getElementById("cust-phone").value = "";
        document.getElementById("payment-dp").value = 0;
        document.getElementById("payment-sisa").innerText = "Rp 0";
        if (document.getElementById("spesifikasi-box")) document.getElementById("spesifikasi-box").style.display = "none";
        
        // Hapus draft otomatis
        if (typeof window.hapusDraftOtomatisGlobal === 'function') window.hapusDraftOtomatisGlobal();

        Swal.fire({
            icon: 'success',
            title: 'Bill Ditahan',
            text: `Pesanan a/n ${namaPenahan} berhasil ditahan sementara.`,
            timer: 2000,
            showConfirmButton: false
        });
        
        updateHoldBadge();
    }
};

window.bukaAntreanTertahan = function() {
    let savedHolds = JSON.parse(localStorage.getItem('hold_bills_putra_print') || '[]');
    
    if (savedHolds.length === 0) {
        Swal.fire("Tidak Ada Antrean", "Belum ada pesanan yang ditahan saat ini.", "info");
        return;
    }

    const listEl = document.getElementById("list-hold-bills");
    if (!listEl) return;

    let html = '';
    savedHolds.forEach((hold) => {
        let totalItem = hold.keranjang.reduce((sum, item) => sum + parseInt(item.qty), 0);
        let totalHarga = hold.keranjang.reduce((sum, item) => sum + item.subtotal, 0);
        html += `
        <div class="d-flex justify-content-between align-items-center border-bottom py-2">
            <div>
                <div class="fw-bold">${hold.nama}</div>
                <small class="text-muted"><i class="fa-regular fa-clock me-1"></i>${hold.waktu} • ${totalItem} Item (Rp ${totalHarga.toLocaleString('id-ID')})</small>
            </div>
            <div>
                <button class="btn btn-sm btn-primary fw-bold" onclick="window.loadHoldBill('${hold.id}')">Buka</button>
                <button class="btn btn-sm btn-outline-danger ms-1" onclick="window.hapusHoldBill('${hold.id}')"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>
        `;
    });
    
    listEl.innerHTML = html;
    new bootstrap.Modal(document.getElementById('modalHoldBills')).show();
};

window.loadHoldBill = function(id) {
    let keranjang = window.getKeranjang ? window.getKeranjang() : [];
    // Cek keranjang saat ini, jika ada isinya, beri peringatan
    if (keranjang && keranjang.length > 0) {
        Swal.fire({
            title: 'Timpa Keranjang?',
            text: 'Keranjang Anda saat ini tidak kosong. Menarik bill ini akan menimpa (menghapus) keranjang Anda yang sekarang.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Ya, Timpa!',
            cancelButtonText: 'Batal'
        }).then((result) => {
            if (result.isConfirmed) {
                prosesLoadHoldBill(id);
            }
        });
    } else {
        prosesLoadHoldBill(id);
    }
};

function prosesLoadHoldBill(id) {
    let savedHolds = JSON.parse(localStorage.getItem('hold_bills_putra_print') || '[]');
    let index = savedHolds.findIndex(h => h.id === id);
    
    if (index !== -1) {
        let holdData = savedHolds[index];
        
        // Pindahkan item ke keranjang global
        let newKeranjang = [];
        holdData.keranjang.forEach(item => newKeranjang.push(item));
        if (window.setKeranjang) window.setKeranjang(newKeranjang);
        
        // Kembalikan form customer
        document.getElementById("cust-name").value = holdData.nama || "";
        document.getElementById("cust-phone").value = holdData.phone || "";
        document.getElementById("payment-dp").value = holdData.dp || 0;
        
        if (typeof window.renderKeranjangGlobal === 'function') window.renderKeranjangGlobal();
        
        // Hapus dari hold array
        savedHolds.splice(index, 1);
        localStorage.setItem('hold_bills_putra_print', JSON.stringify(savedHolds));
        
        // Tutup modal
        const modalEl = document.getElementById('modalHoldBills');
        if (modalEl) {
            const modalInst = bootstrap.Modal.getInstance(modalEl);
            if (modalInst) modalInst.hide();
        }
        
        updateHoldBadge();
        
        // Simpan ke draft terbaru
        if (typeof window.simpanDraftOtomatisGlobal === 'function') window.simpanDraftOtomatisGlobal();
    }
}

window.hapusHoldBill = function(id) {
    Swal.fire({
        title: 'Hapus Pesanan Ditahan?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Ya, Hapus!'
    }).then((result) => {
        if (result.isConfirmed) {
            let savedHolds = JSON.parse(localStorage.getItem('hold_bills_putra_print') || '[]');
            savedHolds = savedHolds.filter(h => h.id !== id);
            localStorage.setItem('hold_bills_putra_print', JSON.stringify(savedHolds));
            window.bukaAntreanTertahan(); // refresh modal
            updateHoldBadge();
        }
    });
};

function updateHoldBadge() {
    let savedHolds = JSON.parse(localStorage.getItem('hold_bills_putra_print') || '[]');
    const badge = document.getElementById('hold-badge-count');
    if (badge) {
        if (savedHolds.length > 0) {
            badge.innerText = savedHolds.length;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }
}

// Initial update on load
document.addEventListener("DOMContentLoaded", () => {
    updateHoldBadge();
});
