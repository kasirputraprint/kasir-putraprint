import { ref, push, set } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { db } from "./firebase-init.js";

// Fungsi untuk mencatat log aktivitas (Audit Trail)
window.logAktivitas = async function(action, detail) {
    if (!window.currentUserUid) return; // Pastikan ada user yang login

    const date = new Date();
    const tglSekarang = date.toISOString().split('T')[0]; // Format YYYY-MM-DD
    const timestamp = date.getTime();
    const jam = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    const logData = {
        waktu: jam,
        timestamp: timestamp,
        kasirUid: window.currentUserUid,
        kasirNama: window.currentUserNama || 'Unknown',
        role: window.currentUserRole || 'kasir',
        action: action,
        detail: detail
    };

    try {
        // Simpan log di: activity_logs/YYYY-MM-DD/pushId
        const newLogRef = push(ref(db, `activity_logs/${tglSekarang}`));
        await set(newLogRef, logData);
        // console.log("Audit log dicatat:", action);
    } catch (error) {
        console.error("Gagal mencatat log aktivitas:", error);
    }
};
