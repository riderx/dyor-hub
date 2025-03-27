'use client';
import { ApiError, tokens } from '@/lib/api';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';

interface ChartPoint {
  time: string;
  price: number;
}

interface TokenPriceChartProps {
  tokenAddress: string;
}

const formatPrice = (value: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value);
};

const formatTime = (unixTime: number) => {
  return new Date(unixTime * 1000).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

// Cache for price history data
const priceHistoryCache = new Map<string, { data: ChartPoint[]; timestamp: number }>();
const CACHE_TTL = 30000; // 30 seconds

const TokenPriceChartComponent = memo(({ tokenAddress }: TokenPriceChartProps) => {
  const [data, setData] = useState<ChartPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPriceUp, setIsPriceUp] = useState<boolean>(false);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchData = useCallback(
    async (retryCount = 0) => {
      try {
        // Check cache first
        const cached = priceHistoryCache.get(tokenAddress);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          setData(cached.data);
          setIsLoading(false);
          const firstPrice = cached.data[0]?.price;
          const lastPrice = cached.data[cached.data.length - 1]?.price;
          setIsPriceUp(lastPrice > firstPrice);
          return;
        }

        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }

        abortControllerRef.current = new AbortController();

        setIsLoading(true);
        setError(null);

        const priceHistory = await tokens.getTokenPriceHistory(
          tokenAddress,
          abortControllerRef.current.signal,
        );

        if (priceHistory.items.length > 0) {
          const formatted = priceHistory.items.map((item) => ({
            time: formatTime(item.unixTime),
            price: item.value,
          }));

          const firstPrice = formatted[0]?.price;
          const lastPrice = formatted[formatted.length - 1]?.price;
          setIsPriceUp(lastPrice > firstPrice);
          setData(formatted);

          // Update cache
          priceHistoryCache.set(tokenAddress, {
            data: formatted,
            timestamp: Date.now(),
          });
        } else {
          setError('No price data available');
        }
      } catch (err) {
        // Type guard for AbortError
        if (err instanceof Error && err.name === 'AbortError') return;

        const errorMessage = err instanceof ApiError ? err.message : 'Failed to load data';

        if (errorMessage.toLowerCase().includes('rate limit') && retryCount < 3) {
          const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 5000);
          setError(`Rate limit exceeded. Retrying in ${retryDelay / 1000}s...`);

          retryTimeoutRef.current = setTimeout(() => {
            fetchData(retryCount + 1);
          }, retryDelay);
        } else {
          setError(errorMessage);
          // On error, keep the cached data if available
          const cached = priceHistoryCache.get(tokenAddress);
          if (cached) {
            setData(cached.data);
            const firstPrice = cached.data[0]?.price;
            const lastPrice = cached.data[cached.data.length - 1]?.price;
            setIsPriceUp(lastPrice > firstPrice);
          }
        }
      } finally {
        setIsLoading(false);
      }
    },
    [tokenAddress],
  );

  useEffect(() => {
    // Clear any pending timeouts
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }

    // Debounce the fetch call
    fetchTimeoutRef.current = setTimeout(() => {
      fetchData();
    }, 100);

    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
    };
  }, [tokenAddress, fetchData]);

  if (isLoading && !data.length) {
    return (
      <div className='w-full h-[120px] p-4 bg-zinc-900 rounded-xl shadow flex items-center justify-center'>
        <div className='animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-blue-500'></div>
      </div>
    );
  }

  if (error && !data.length) {
    return (
      <div className='w-full h-[120px] p-4 bg-zinc-900 rounded-xl shadow flex items-center justify-center'>
        <p className='text-sm text-zinc-400'>{error}</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className='w-full h-[120px] p-4 bg-zinc-900 rounded-xl shadow flex items-center justify-center'>
        <p className='text-sm text-zinc-400'>No price data available</p>
      </div>
    );
  }

  return (
    <div className='relative w-full h-[120px] bg-zinc-900 rounded-xl shadow'>
      <div className='absolute top-2 left-3 text-xs text-zinc-400'>24h</div>
      <ResponsiveContainer width='100%' height='100%'>
        <LineChart data={data} margin={{ top: 20, right: 10, bottom: 10, left: 10 }}>
          <YAxis domain={['dataMin', 'dataMax']} hide={true} />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length > 0 && payload[0].payload) {
                return (
                  <div className='bg-zinc-800/90 px-3 py-2 rounded-lg border border-zinc-700/50 shadow-lg backdrop-blur-sm'>
                    <p className='text-xs text-zinc-400'>{payload[0].payload.time}</p>
                    <p className='text-sm font-medium text-white'>
                      {formatPrice(payload[0].value as number)}
                    </p>
                  </div>
                );
              }
              return null;
            }}
            cursor={{ stroke: '#525252', strokeWidth: 1 }}
          />
          <Line
            type='monotone'
            dataKey='price'
            stroke={isPriceUp ? '#22c55e' : '#ef4444'}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});

TokenPriceChartComponent.displayName = 'TokenPriceChart';

export default TokenPriceChartComponent;
