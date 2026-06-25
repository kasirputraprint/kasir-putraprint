// ==============================================================================
// FITUR KENYAMANAN: SHORTCUT KEYBOARD KASIR
// ==============================================================================

window.addEventListener('keydown', function(e) {
    // Jangan tangkap event jika berada di dalam modal/popup terbuka
    if (document.querySelector('.modal.show')) return;
    
    // F2: Fokus ke Pencarian Produk
    if (e.key === 'F2') {
        e.preventDefault();
        const searchInput = document.getElementById('search-produk');
        if (searchInput) {
            // Pastikan tab kasir aktif
            if (typeof switchTab === 'function' && document.getElementById('menu-kasir')) {
                switchTab('panel-kasir', document.getElementById('menu-kasir'));
            }
            searchInput.focus();
        }
    }
    
    // F4: Fokus ke Nominal DP / Pembayaran
    if (e.key === 'F4') {
        e.preventDefault();
        const dpInput = document.getElementById('payment-dp');
        if (dpInput) {
            if (typeof switchTab === 'function' && document.getElementById('menu-kasir')) {
                switchTab('panel-kasir', document.getElementById('menu-kasir'));
            }
            dpInput.focus();
            dpInput.select();
        }
    }
    
    // F8: Simpan & Cetak Struk
    if (e.key === 'F8') {
        e.preventDefault();
        const btnPrint = document.querySelector('button[onclick="window.simpanTransaksi(\\\'PRINT\\\')"]');
        if (btnPrint && !btnPrint.disabled) {
            btnPrint.click();
        }
    }

    // F9: Tahan Keranjang (Hold Bill)
    if (e.key === 'F9') {
        e.preventDefault();
        if (typeof window.tahanKeranjang === 'function') {
            window.tahanKeranjang();
        }
    }

    // F10: Buka Antrean Tertahan (Open Hold Bills)
    if (e.key === 'F10') {
        e.preventDefault();
        if (typeof window.bukaAntreanTertahan === 'function') {
            window.bukaAntreanTertahan();
        }
    }
});
