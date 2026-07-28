import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores/authStore';
import styles from './Login.module.css';

export default function Login() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    setIsLoading(true);
    try {
      // Call the IPC method to handle OAuth window and token exchange
      const authData = await (window as any).electronAPI.loginSSO();
      
      if (authData && authData.access_token) {
        // Here we parse the JWT or use default values if needed
        const user = {
          // Axis returns user.id as a string (UUID), so we might need to cast or adapt it depending on the store's strictness
          userId: authData.user?.id || 1, 
          username: authData.user?.email || 'user@example.com',
          name: (authData.user?.email || 'User').split('@')[0],
          email: authData.user?.email || 'user@example.com',
          empNo: authData.user?.empNo || 'EMP001',
          roles: authData.roles ? Object.keys(authData.roles) : ['ROLE_USER']
        };
        
        setAuth({
          user,
          accessToken: authData.access_token,
          refreshToken: authData.refresh_token,
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
      <h2 style={{ textAlign: 'center', marginBottom: '1.5rem' }}>Welcome to PMS</h2>
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
