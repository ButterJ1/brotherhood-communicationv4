-- 建立資料庫 (忽略已存在錯誤)
SELECT 'CREATE DATABASE secure_chat_auth'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'secure_chat_auth')\gexec

SELECT 'CREATE DATABASE secure_chat_messages'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'secure_chat_messages')\gexec

-- 建立使用者
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'auth_user') THEN
        CREATE USER auth_user WITH PASSWORD 'auth_password';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'message_user') THEN
        CREATE USER message_user WITH PASSWORD 'message_password';
    END IF;
END
$$;

-- 授權
GRANT ALL PRIVILEGES ON DATABASE secure_chat_auth TO auth_user;
GRANT ALL PRIVILEGES ON DATABASE secure_chat_messages TO message_user;

-- 切換到認證資料庫並啟用UUID擴展
\c secure_chat_auth;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

GRANT ALL ON SCHEMA public TO auth_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO auth_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO auth_user;

-- 切換到訊息資料庫並啟用UUID擴展
\c secure_chat_messages;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; 
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

GRANT ALL ON SCHEMA public TO message_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO message_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO message_user;
