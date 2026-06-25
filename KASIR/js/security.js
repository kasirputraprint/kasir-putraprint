// ==============================================================================
// FITUR KEAMANAN: AUTO-LOGOUT JIKA IDLE (15 Menit)
// ==============================================================================

import { auth } from "./firebase-init.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const IDLE_TIMEOUT = 15 * 60 * 1000; // 15 menit dalam milidetik
let idleTimer;

function resetTimer() {
    clearTimeout(idleTimer);
    if (window.currentUserUid) {
        idleTimer = setTimeout(forceLogout, IDLE_TIMEOUT);
    }
}

async function forceLogout() {
    if (!window.currentUserUid) return;
    
    // Jangan logout jika sedang ada di keranjang transaksi yang belum tersimpan
    // Biarkan saja layar terkunci tapi kita gunakan SweetAlert yang tidak bisa diclose
    
    // Supaya lebih aman, sign out beneran
    try {
        await signOut(auth);
        
        Swal.fire({
            title: 'Sesi Berakhir',
            text: 'Komputer telah dikunci otomatis karena tidak ada aktivitas selama 15 menit demi keamanan.',
            icon: 'warning',
            allowOutsideClick: false,
            allowEscapeKey: false,
            confirmButtonText: 'Masuk Kembali'
        }).then(() => {
            window.location.reload();
        });
    } catch (e) {
        console.error("Gagal auto-logout:", e);
    }
}

// Pasang event listener untuk mendeteksi aktivitas pengguna
window.addEventListener('mousemove', resetTimer);
window.addEventListener('mousedown', resetTimer);
window.addEventListener('keypress', resetTimer);
window.addEventListener('touchmove', resetTimer);
window.addEventListener('scroll', resetTimer, true);

// Mulai timer pertama kali
resetTimer();
