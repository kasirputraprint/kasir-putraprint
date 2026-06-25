import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

export const firebaseConfig = {
    apiKey: "AIzaSyBb65AtDlOIlvPQEIFj2NJkJ27FnlyhRFQ",
    authDomain: "putra-print-kasir.firebaseapp.com",
    databaseURL: "https://putra-print-kasir-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "putra-print-kasir",
    storageBucket: "putra-print-kasir.firebasestorage.app",
    messagingSenderId: "748848608576",
    appId: "1:748848608576:web:2d060db484ef011b37f6a5",
    measurementId: "G-1R2CXYY805"
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
