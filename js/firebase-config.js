// Firebase の接続先（プロジェクト sword-crest）。Webアプリに組み込んで公開する前提の値で、パスワードではない。
// データの読み書きは Firestore のセキュリティルール（自分のセーブだけ）と、Authentication の承認済みドメインで守る
window.QP_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBMHSnlHAdk1zXnfQ8mn492f0YqxF81WRM",
  authDomain: "sword-crest.firebaseapp.com",
  projectId: "sword-crest",
  storageBucket: "sword-crest.firebasestorage.app",
  messagingSenderId: "356125530998",
  appId: "1:356125530998:web:12903b2747ed6e7b12f857",
};
