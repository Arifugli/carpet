-- Выполнить отдельной транзакцией перед 0003 (PostgreSQL enum).
alter type public.user_role add value if not exists 'manager';
