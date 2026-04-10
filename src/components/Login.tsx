import React, { useState, useEffect } from 'react';
import { Anchor, Loader2, UserCircle, AlertTriangle, LogIn, Mail, Lock } from 'lucide-react';
import { db, doc, getDoc, setDoc } from '../firebase';

interface LoginProps {
  onLogin: (user: any) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Seed default admin on mount if not exists
  useEffect(() => {
    const seedAdmin = async () => {
      const adminEmail = "admin@jamaicaships.com";
      const adminPass = "admin123";
      
      try {
        // Check Firestore first
        const adminDoc = await getDoc(doc(db, 'users', adminEmail));
        if (!adminDoc.exists()) {
          // Create in Firestore
          await setDoc(doc(db, 'users', adminEmail), {
            name: "System Administrator",
            email: adminEmail,
            password: adminPass,
            role: 'admin',
            createdAt: new Date().toISOString()
          });
        }
      } catch (err) {
        console.error("Seeding error:", err);
      }
    };
    seedAdmin();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }

    setError('');
    setIsLoading(true);
    try {
      // Custom Login: Check Firestore directly
      const userDoc = await getDoc(doc(db, 'users', email.toLowerCase()));
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        if (userData.password === password) {
          // Success!
          const user = { id: email.toLowerCase(), ...userData };
          localStorage.setItem('maj_user', JSON.stringify(user));
          onLogin(user);
        } else {
          setError('Invalid email or password.');
        }
      } else {
        setError('Invalid email or password.');
      }
    } catch (err: any) {
      console.error(err);
      setError('Failed to connect to database. Please check your connection.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl p-8 max-w-md w-full text-center border-t-8 border-gold-500 animate-fade-in">
        <div className="flex justify-center mb-6">
          <div className="bg-navy-900 p-4 rounded-full shadow-lg border-4 border-gold-500">
            <Anchor className="w-12 h-12 text-white" />
          </div>
        </div>
        
        <h1 className="text-2xl font-bold text-navy-900 mb-2">Maritime Authority of Jamaica</h1>
        <p className="text-gray-500 mb-8">Secure Database Access</p>
        
        <form onSubmit={handleLogin} className="space-y-4 text-left">
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-bold text-gray-400 mb-1 ml-1">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg py-3 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-navy-500 transition"
                placeholder="admin@jamaicaships.com"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest font-bold text-gray-400 mb-1 ml-1">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg py-3 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-navy-500 transition"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-semibold border border-red-100 flex items-center gap-2">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}
          
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-navy-900 hover:bg-navy-800 text-white font-bold py-3 px-4 rounded-lg transition duration-200 shadow-lg flex justify-center items-center gap-3 disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="animate-spin" />
            ) : (
              <>
                <LogIn size={18} />
                Access Database
              </>
            )}
          </button>
        </form>
        
        <div className="mt-8 pt-6 border-t border-gray-100">
          <div className="flex items-center justify-center gap-2 text-gray-400">
            <UserCircle size={16} />
            <span className="text-xs uppercase tracking-widest font-bold">Authorized Personnel Only</span>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">
            Access is restricted to authorized Maritime Authority personnel.
          </p>
        </div>
      </div>
    </div>
  );
};
