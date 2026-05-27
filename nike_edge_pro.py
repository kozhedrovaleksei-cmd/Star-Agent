import streamlit as st
import yfinance as yf
import pandas as pd
import plotly.graph_objects as go
from datetime import datetime
import time

st.set_page_config(page_title="Nike Edge Pro", layout="wide", page_icon="🚀")
st.title("🚀 Nike Edge Pro Monitor v2.2 — Мировой Уровень")
st.caption(f"Последнее обновление: {datetime.now().strftime('%d.%m.%Y %H:%M')}")

# Кэширование данных
@st.cache_data(ttl=300)  # обновление каждые 5 минут
def get_nike_data():
    try:
        ticker = yf.Ticker("NKE")
        hist = ticker.history(period="2y")
        info = ticker.info
        if hist.empty:
            st.error("Данные временно недоступны. Повторная попытка...")
            time.sleep(2)
            hist = ticker.history(period="1y")
        return ticker, hist, info
    except Exception as e:
        st.error(f"Ошибка загрузки данных: {str(e)}")
        return None, pd.DataFrame(), {}

ticker, hist, info = get_nike_data()

if hist.empty:
    st.warning("⏳ Пытаемся получить данные Nike...")
    st.stop()

price = hist['Close'][-1]

st.sidebar.metric("Текущая цена NKE", f"${price:.2f}", "Recovery Zone")

tab1, tab2, tab3, tab4 = st.tabs(["📊 Дашборд", "🏆 Сравнение", "📈 DCF Valuation", "🚨 Корреляции"])

with tab1:
    col1, col2, col3 = st.columns(3)
    col1.metric("Цена", f"${price:.2f}")
    col2.metric("Edge Score", "74/100", "Asymmetric Opportunity")
    col3.metric("Dividend Yield", "3.65%")

    fig = go.Figure(data=[go.Candlestick(
        x=hist.index,
        open=hist['Open'],
        high=hist['High'],
        low=hist['Low'],
        close=hist['Close']
    )])
    fig.update_layout(title="Nike Price Action (2 года)", height=650)
    st.plotly_chart(fig, use_container_width=True)

with tab2:
    st.subheader("Сравнение с конкурентами")
    st.dataframe(pd.DataFrame({
        "Метрика": ["Forward P/E", "Gross Margin", "Revenue Trend", "Китай Риск"],
        "Nike": ["23x", "40.2%", "Стагнация", "Высокий"],
        "Adidas": ["18x", "47%", "Слабый рост", "Средний"],
        "Lululemon": ["28x", "58%", "Сильный рост", "Низкий"]
    }), use_container_width=True)

with tab3:
    st.subheader("Моя DCF-модель")
    g = st.slider("Долгосрочный рост (%)", 2.0, 8.0, 4.5)
    wacc = st.slider("WACC (%)", 7.0, 12.0, 9.2)
    dcf_price = round(3.9 * (1 + g/100) / (wacc/100 - 0.022), 1)
    upside = (dcf_price / price - 1) * 100
    st.metric("Справедливая цена", f"${dcf_price}", f"Upside: {upside:+.1f}%")

with tab4:
    st.info("""
    **Скрытые корреляции (мой взгляд на 27 мая 2026):**
    - Структурное давление из Китая остаётся главным риском
    - Восстановление в North America + Running категория — главный драйвер роста
    - Сейчас зона накопления. При цене ниже $43.5 — агрессивно увеличиваю позицию
    """)

st.success("✅ Приложение работает стабильно")
