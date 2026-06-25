import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { ref, set } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { firebaseConfig, db } from "./firebase-init.js";

// Hashing sederhana menggunakan Web Crypto API (SHA-256)
export async function hashPIN(pinStr) {
    const encoder = new TextEncoder();
    const data = encoder.encode(pinStr);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

// Menambahkan staf baru via App Sekunder (TIDAK MELOGOUT owner yang sedang masuk)
export async function registerStaff(username, password, role = 'kasir') {
    let secondaryApp;
    try {
        // Buat instans sekunder
        secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
        const secondaryAuth = getAuth(secondaryApp);
        
        // Buat email palsu internal
        const fakeEmail = `${username.toLowerCase()}@putraprint.com`;

        // Buat user
        const userCredential = await createUserWithEmailAndPassword(secondaryAuth, fakeEmail, password);
        const user = userCredential.user;

        // Set info di profil auth
        await updateProfile(user, { displayName: username });

        // Simpan role di Realtime Database utama
        await set(ref(db, `users/${user.uid}`), {
            nama: username,
            role: role,
            email: fakeEmail,
            lastPasswordChange: Date.now()
        });

        // Sign out dari secondary auth
        await secondaryAuth.signOut();
        
        return { success: true, uid: user.uid };
    } catch (error) {
        console.error("Gagal mendaftar staf:", error);
        return { success: false, error: error.message };
    }
}
