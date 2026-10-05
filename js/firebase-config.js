// Firebase の接続先（プロジェクト sword-crest-jp、Firestore は東京 asia-northeast1）。
// Webアプリに組み込んで公開する前提の値で、パスワードではない。
// データの読み書きは Firestore のセキュリティルール（自分のセーブだけ）と、Authentication の承認済みドメインで守る
window.QP_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCU3bGkyAkl-Vrv3lyy_HP7Wnyqx19ADR0",
  authDomain: "sword-crest-jp.firebaseapp.com",
  projectId: "sword-crest-jp",
  storageBucket: "sword-crest-jp.firebasestorage.app",
  messagingSenderId: "470641942488",
  appId: "1:470641942488:web:7373610a8472309e129cad",
};
