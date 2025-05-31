// client/src/components/EncryptionDemo.jsx
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { cryptoService } from '../services/crypto';
import LoadingSpinner from './LoadingSpinner';

const EncryptionDemo = () => {
  const [demoData, setDemoData] = useState({
    plaintext: '這是一個機密訊息，只有授權的使用者才能看到！',
    encrypted: '',
    decrypted: '',
    dek: '',
    wrappedDek: '',
    contentHash: '',
    processing: false
  });
  const [step, setStep] = useState(0);
  const [cryptoStats, setCryptoStats] = useState(null);

  useEffect(() => {
    initDemo();
  }, []);

  const initDemo = async () => {
    try {
      await cryptoService.init();
      setCryptoStats(cryptoService.getStats());
    } catch (error) {
      console.error('Failed to initialize crypto demo:', error);
    }
  };

  const runEncryptionDemo = async () => {
    setDemoData(prev => ({ ...prev, processing: true }));
    setStep(0);

    try {
      // 步驟 1: 生成 DEK
      await delay(1000);
      setStep(1);
      const dek = await cryptoService.generateDEK();
      const dekString = await cryptoService.exportDEK(dek);
      setDemoData(prev => ({ ...prev, dek: dekString }));

      // 步驟 2: 加密訊息
      await delay(1000);
      setStep(2);
      const encrypted = await cryptoService.encryptWithDEK(demoData.plaintext, dek);
      setDemoData(prev => ({ ...prev, encrypted }));

      // 步驟 3: 計算雜湊
      await delay(1000);
      setStep(3);
      const hash = await cryptoService.calculateHash(encrypted);
      setDemoData(prev => ({ ...prev, contentHash: hash }));

      // 步驟 4: 包裝 DEK
      await delay(1000);
      setStep(4);
      const wrappedData = await cryptoService.mockWrapDEK(dek);
      setDemoData(prev => ({ ...prev, wrappedDek: wrappedData.wrappedDek }));

      // 步驟 5: 解包裝和解密
      await delay(1000);
      setStep(5);
      const unwrappedDek = await cryptoService.mockUnwrapDEK(wrappedData);
      const decrypted = await cryptoService.decryptWithDEK(encrypted, unwrappedDek);
      setDemoData(prev => ({ ...prev, decrypted }));

      setStep(6);
    } catch (error) {
      console.error('Demo failed:', error);
    } finally {
      setDemoData(prev => ({ ...prev, processing: false }));
    }
  };

  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const resetDemo = () => {
    setDemoData({
      plaintext: '這是一個機密訊息，只有授權的使用者才能看到！',
      encrypted: '',
      decrypted: '',
      dek: '',
      wrappedDek: '',
      contentHash: '',
      processing: false
    });
    setStep(0);
  };

  const stepInfo = [
    { title: '準備中', desc: '初始化加密環境' },
    { title: '生成 DEK', desc: '產生 256 位元的資料加密金鑰' },
    { title: '加密資料', desc: '使用 AES-256-GCM 加密訊息內容' },
    { title: '計算雜湊', desc: '使用 SHA-256 驗證資料完整性' },
    { title: '包裝金鑰', desc: '使用主金鑰包裝 DEK（模擬 KACLS）' },
    { title: '解密驗證', desc: '解包裝金鑰並還原原始訊息' },
    { title: '完成', desc: '端到端加密流程展示完成' }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* 標題區域 */}
        <div className="text-center mb-12">
          <div className="mx-auto h-16 w-16 bg-purple-600 rounded-full flex items-center justify-center mb-6">
            <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            加密技術展示
          </h1>
          <p className="text-lg text-gray-600 mb-6">
            了解端到端加密如何保護您的訊息安全
          </p>
          <Link 
            to="/login" 
            className="inline-flex items-center gap-2 text-purple-600 hover:text-purple-700 font-medium"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            返回登入
          </Link>
        </div>

        {/* 加密統計資訊 */}
        {cryptoStats && (
          <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
            <h3 className="text-lg font-semibold mb-4">瀏覽器加密支援狀態</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <div className={`w-12 h-12 rounded-full mx-auto mb-2 flex items-center justify-center ${
                  cryptoStats.isSupported ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                }`}>
                  {cryptoStats.isSupported ? '✓' : '✗'}
                </div>
                <div className="font-medium">Web Crypto API</div>
                <div className="text-sm text-gray-500">
                  {cryptoStats.isSupported ? '已支援' : '不支援'}
                </div>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full mx-auto mb-2 flex items-center justify-center">
                  🔐
                </div>
                <div className="font-medium">加密演算法</div>
                <div className="text-sm text-gray-500">AES-256-GCM</div>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-full mx-auto mb-2 flex items-center justify-center">
                  #
                </div>
                <div className="font-medium">雜湊函數</div>
                <div className="text-sm text-gray-500">SHA-256</div>
              </div>
            </div>
          </div>
        )}

        {/* 流程展示 */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold">加密流程展示</h3>
            <div className="flex gap-3">
              <button
                onClick={runEncryptionDemo}
                disabled={demoData.processing}
                className="btn btn-primary"
              >
                {demoData.processing ? (
                  <>
                    <LoadingSpinner size="small" color="white" />
                    執行中...
                  </>
                ) : (
                  '開始展示'
                )}
              </button>
              <button
                onClick={resetDemo}
                disabled={demoData.processing}
                className="btn btn-secondary"
              >
                重置
              </button>
            </div>
          </div>

          {/* 步驟指示器 */}
          <div className="flex items-center justify-between mb-8 overflow-x-auto">
            {stepInfo.map((info, index) => (
              <div key={index} className="flex flex-col items-center min-w-0 flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  index <= step ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-500'
                }`}>
                  {index < step ? '✓' : index + 1}
                </div>
                <div className="mt-2 text-xs text-center">
                  <div className="font-medium">{info.title}</div>
                  <div className="text-gray-500 hidden sm:block">{info.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* 資料展示區域 */}
          <div className="space-y-6">
            {/* 原始訊息 */}
            <div className="border border-gray-200 rounded-lg p-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                原始訊息（明文）
              </label>
              <textarea
                value={demoData.plaintext}
                onChange={(e) => setDemoData(prev => ({ ...prev, plaintext: e.target.value }))}
                className="w-full h-20 p-3 border border-gray-300 rounded-md resize-none"
                placeholder="輸入要加密的訊息..."
                disabled={demoData.processing}
              />
            </div>

            {/* DEK */}
            {demoData.dek && (
              <div className="border border-blue-200 rounded-lg p-4 bg-blue-50">
                <label className="block text-sm font-medium text-blue-800 mb-2">
                  資料加密金鑰（DEK）- Base64 編碼
                </label>
                <div className="font-mono text-sm bg-white p-3 rounded border break-all">
                  {demoData.dek}
                </div>
              </div>
            )}

            {/* 加密結果 */}
            {demoData.encrypted && (
              <div className="border border-green-200 rounded-lg p-4 bg-green-50">
                <label className="block text-sm font-medium text-green-800 mb-2">
                  加密後內容（密文）
                </label>
                <div className="font-mono text-sm bg-white p-3 rounded border break-all">
                  {demoData.encrypted}
                </div>
              </div>
            )}

            {/* 雜湊值 */}
            {demoData.contentHash && (
              <div className="border border-yellow-200 rounded-lg p-4 bg-yellow-50">
                <label className="block text-sm font-medium text-yellow-800 mb-2">
                  內容雜湊（SHA-256）
                </label>
                <div className="font-mono text-sm bg-white p-3 rounded border break-all">
                  {demoData.contentHash}
                </div>
              </div>
            )}

            {/* 包裝後的 DEK */}
            {demoData.wrappedDek && (
              <div className="border border-purple-200 rounded-lg p-4 bg-purple-50">
                <label className="block text-sm font-medium text-purple-800 mb-2">
                  包裝後的 DEK（由 KACLS 處理）
                </label>
                <div className="font-mono text-sm bg-white p-3 rounded border break-all">
                  {demoData.wrappedDek}
                </div>
              </div>
            )}

            {/* 解密結果 */}
            {demoData.decrypted && (
              <div className="border border-green-200 rounded-lg p-4 bg-green-50">
                <label className="block text-sm font-medium text-green-800 mb-2">
                  解密後內容（明文）
                </label>
                <div className="p-3 bg-white rounded border">
                  {demoData.decrypted}
                </div>
                {demoData.decrypted === demoData.plaintext && (
                  <div className="mt-2 text-sm text-green-600 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    解密成功！內容完全匹配
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 技術說明 */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="text-lg font-semibold mb-4">技術架構說明</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold text-gray-800 mb-3">🔐 加密流程</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>• 在瀏覽器中生成 256 位元 AES 金鑰</li>
                <li>• 使用 AES-256-GCM 模式加密訊息</li>
                <li>• 計算 SHA-256 雜湊確保完整性</li>
                <li>• 透過 KACLS 服務包裝加密金鑰</li>
                <li>• 只儲存加密後的內容和包裝金鑰</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-gray-800 mb-3">🛡️ 安全特性</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>• 端到端加密，伺服器無法解密</li>
                <li>• 職責分離架構設計</li>
                <li>• 雙重 JWT 認證機制</li>
                <li>• 金鑰輪換和撤銷支援</li>
                <li>• 完整的稽核日誌記錄</li>
              </ul>
            </div>
          </div>
          
          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <svg className="w-5 h-5 text-blue-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h5 className="font-medium text-gray-800 mb-1">重要說明</h5>
                <p className="text-sm text-gray-600">
                  這個展示使用了瀏覽器的 Web Crypto API 來模擬真實的加密流程。
                  在生產環境中，金鑰管理將由專門的 KACLS（Key Access Control List Service）服務處理，
                  提供更高等級的安全保護。
                </p>
              </div>
            </div>
          </div>

          {/* 架構圖 */}
          <div className="mt-6">
            <h4 className="font-semibold text-gray-800 mb-3">🏗️ 系統架構</h4>
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                <div className="bg-blue-100 p-4 rounded-lg">
                  <div className="font-semibold text-blue-800">身分驗證服務</div>
                  <div className="text-sm text-blue-600 mt-1">JWT 令牌管理</div>
                </div>
                <div className="bg-purple-100 p-4 rounded-lg">
                  <div className="font-semibold text-purple-800">金鑰管理服務</div>
                  <div className="text-sm text-purple-600 mt-1">KACLS 包裝/解包裝</div>
                </div>
                <div className="bg-green-100 p-4 rounded-lg">
                  <div className="font-semibold text-green-800">訊息儲存服務</div>
                  <div className="text-sm text-green-600 mt-1">加密資料儲存</div>
                </div>
              </div>
              <div className="mt-4 text-center">
                <div className="bg-orange-100 p-3 rounded-lg inline-block">
                  <div className="font-semibold text-orange-800">客戶端瀏覽器</div>
                  <div className="text-sm text-orange-600">Web Crypto API 加密</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EncryptionDemo;