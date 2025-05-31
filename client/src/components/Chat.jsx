// client/src/components/Chat.jsx
import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { roomAPI, messageAPI } from '../services/api';
import { cryptoService } from '../services/crypto';
import LoadingSpinner from './LoadingSpinner';
import toast from 'react-hot-toast';

const Chat = () => {
  const { user, logout } = useAuth();
  const [rooms, setRooms] = useState([]);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  // 載入房間列表
  useEffect(() => {
    loadRooms();
  }, []);

  // 載入訊息
  useEffect(() => {
    if (currentRoom) {
      loadMessages(currentRoom.id);
    }
  }, [currentRoom]);

  const loadRooms = async () => {
    try {
      const response = await roomAPI.getRooms();
      setRooms(response.data.rooms || []);
      if (response.data.rooms && response.data.rooms.length > 0) {
        setCurrentRoom(response.data.rooms[0]);
      }
    } catch (error) {
      console.error('Failed to load rooms:', error);
      toast.error('載入聊天室失敗');
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (roomId) => {
    try {
      const response = await messageAPI.getMessages(roomId, { limit: 50 });
      const messagesData = response.data.messages || [];
      
      // 解密訊息
      const decryptedMessages = await Promise.all(
        messagesData.map(async (msg) => {
          try {
            const decryptedContent = await cryptoService.decryptMessage({
              encryptedContent: msg.encryptedContent,
              contentHash: msg.contentHash,
              wrappedDek: msg.wrappedDek,
              dekAuthTag: msg.dekAuthTag
            });
            return { ...msg, content: decryptedContent };
          } catch (error) {
            console.error('Failed to decrypt message:', error);
            return { ...msg, content: '[解密失敗]' };
          }
        })
      );
      
      setMessages(decryptedMessages.reverse()); // 最新的在下面
    } catch (error) {
      console.error('Failed to load messages:', error);
      toast.error('載入訊息失敗');
    }
  };

  const createRoom = async () => {
    const roomName = prompt('請輸入聊天室名稱:');
    if (!roomName) return;

    try {
      const response = await roomAPI.createRoom({
        name: roomName,
        description: '新建立的聊天室',
        roomType: 'private'
      });
      
      toast.success('聊天室建立成功！');
      await loadRooms();
      setCurrentRoom(response.data.room);
    } catch (error) {
      console.error('Failed to create room:', error);
      toast.error('建立聊天室失敗');
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !currentRoom || sending) return;

    setSending(true);
    try {
      // 加密訊息
      const encryptedData = await cryptoService.encryptMessage(newMessage.trim());
      
      // 發送到伺服器
      await messageAPI.sendMessage({
        roomId: currentRoom.id,
        encryptedContent: encryptedData.encryptedContent,
        contentHash: encryptedData.contentHash,
        wrappedDek: encryptedData.wrappedDek,
        dekAuthTag: encryptedData.dekAuthTag,
        kacls_wrap_id: encryptedData.kaclsWrapId,
        messageType: 'text',
        metadata: {}
      });

      setNewMessage('');
      toast.success('訊息發送成功！');
      
      // 重新載入訊息
      await loadMessages(currentRoom.id);
    } catch (error) {
      console.error('Failed to send message:', error);
      toast.error('發送訊息失敗');
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="large" text="載入聊天室..." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* 側邊欄 */}
      <div className="w-1/4 bg-white border-r border-gray-200 flex flex-col">
        {/* 標題區域 */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-gray-800">安全聊天</h1>
            <button
              onClick={logout}
              className="text-gray-500 hover:text-gray-700"
              title="登出"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
          <p className="text-sm text-gray-500">歡迎，{user?.username}</p>
        </div>

        {/* 聊天室列表 */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-700">聊天室</h2>
              <button
                onClick={createRoom}
                className="text-primary-600 hover:text-primary-700"
                title="建立聊天室"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </button>
            </div>
            
            {rooms.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 mb-4">還沒有聊天室</p>
                <button
                  onClick={createRoom}
                  className="btn btn-primary"
                >
                  建立第一個聊天室
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {rooms.map((room) => (
                  <button
                    key={room.id}
                    onClick={() => setCurrentRoom(room)}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      currentRoom?.id === room.id
                        ? 'bg-primary-100 text-primary-800'
                        : 'hover:bg-gray-100'
                    }`}
                  >
                    <div className="font-medium">{room.name}</div>
                    <div className="text-sm text-gray-500">
                      {room.memberCount} 位成員
                      {room.unreadCount > 0 && (
                        <span className="ml-2 bg-red-500 text-white text-xs px-2 py-1 rounded-full">
                          {room.unreadCount}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 主聊天區域 */}
      <div className="flex-1 flex flex-col">
        {currentRoom ? (
          <>
            {/* 聊天室標題 */}
            <div className="bg-white p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">{currentRoom.name}</h2>
              <p className="text-sm text-gray-500">
                {currentRoom.description || '安全的端到端加密聊天'}
              </p>
            </div>

            {/* 訊息區域 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <p className="text-gray-500">開始對話吧！</p>
                  <p className="text-sm text-gray-400 mt-2">所有訊息都經過端到端加密</p>
                </div>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.senderId === user?.id ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                        message.senderId === user?.id
                          ? 'bg-primary-600 text-white'
                          : 'bg-white border border-gray-200'
                      }`}
                    >
                      {message.senderId !== user?.id && (
                        <div className="text-xs font-medium mb-1 opacity-75">
                          {message.senderName}
                        </div>
                      )}
                      <div>{message.content}</div>
                      <div className={`text-xs mt-1 opacity-75`}>
                        {new Date(message.createdAt).toLocaleTimeString('zh-TW', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* 輸入區域 */}
            <div className="bg-white border-t border-gray-200 p-4">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <textarea
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="輸入訊息... (按 Enter 發送)"
                    className="w-full resize-none border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    rows="2"
                    disabled={sending}
                  />
                </div>
                <button
                  onClick={sendMessage}
                  disabled={!newMessage.trim() || sending}
                  className="btn btn-primary px-6 py-2 disabled:opacity-50"
                >
                  {sending ? (
                    <LoadingSpinner size="small" color="white" />
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )}
                </button>
              </div>
              <div className="mt-2 text-xs text-gray-500 flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                端到端加密保護
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a2 2 0 01-2-2v-6a2 2 0 012-2h8z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-700 mb-2">選擇一個聊天室</h3>
              <p className="text-gray-500">從左側選擇或建立一個聊天室開始對話</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Chat;