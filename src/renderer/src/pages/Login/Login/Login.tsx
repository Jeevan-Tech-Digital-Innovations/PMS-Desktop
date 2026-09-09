import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores/authStore';
import { config } from '@/config/config';
import styles from './Login.module.css';

export default function Login() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    setIsLoading(true);
    try {
      // Call the IPC method to handle OAuth window and token exchange
      const authData = await (window as any).electronAPI.loginSSO({
        axisWebUrl: config.AXIS_WEB_URL,
        axisApiUrl: config.AXIS_API_URL,
      });
      
      const accessToken = authData.access_token || authData.accessToken || authData.data?.accessToken;
      
      if (accessToken) {
        // Here we parse the JWT or use default values if needed
        const userData = authData.user || authData.data?.user || {};
        const user = {
          // Axis returns user.id as a string (UUID), so we might need to cast or adapt it depending on the store's strictness
          userId: userData.id || 1, 
          username: userData.email || 'user@example.com',
          name: (userData.email || 'User').split('@')[0],
          email: userData.email || 'user@example.com',
          empNo: userData.empNo || 'EMP001',
          roles: authData.roles ? Object.keys(authData.roles) : []
        };
        
        setAuth({
          user,
          accessToken,
          refreshToken: authData.refresh_token || authData.refreshToken || authData.data?.refreshToken || '',
          rememberMe: true,
        });
        toast.success('Login successful');
        navigate('/dashboard');
      } else {
        toast.error('Login failed, no tokens received');
      }
    } catch (error: any) {
      console.error('SSO Login error:', error);
      toast.error(error.message || 'SSO Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.form}>
      <h2 style={{ textAlign: 'center', marginBottom: '1.5rem', color: '#666', fontWeight: 400, fontFamily: "'Inter', 'Segoe UI', sans-serif", fontSize: '0.9375rem' }}>Welcome to PMS</h2>
      <p style={{ textAlign: 'center', marginBottom: '2rem', color: '#666' }}>
        Log in via Axis Single Sign-On
      </p>
      <button 
        type="button" 
        className={styles.submitBtn} 
        onClick={handleLogin} 
        disabled={isLoading}
      >
        {isLoading ? 'Signing in...' : 'Log In with Axis'}
      </button>
    </div>
  );
}
