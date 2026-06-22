import { auth } from './firebase-init.js';
import {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// ====================================================
// FUNGSI: Cek apakah sudah login. Jika belum, redirect ke login.html
// Panggil ini di index.html
// ====================================================
export function requireAuth(onLoggedIn) {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // User sudah login — jalankan callback dengan info user
            if (onLoggedIn) onLoggedIn(user);
        } else {
            // Belum login — paksa ke halaman login
            window.location.replace('login.html');
        }
    });
}

// ====================================================
// FUNGSI: Login dengan email & password
// ====================================================
export async function loginUser(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
}

// ====================================================
// FUNGSI: Logout
// ====================================================
export async function logoutUser() {
    return signOut(auth);
}

// ====================================================
// FUNGSI: Ambil user yang sedang login (sync)
// ====================================================
export function getCurrentUser() {
    return auth.currentUser;
}
