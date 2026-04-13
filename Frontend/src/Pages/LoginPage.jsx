import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../Services/api";
import { FiMail, FiLock, FiEye, FiEyeOff, FiArrowRight } from "react-icons/fi";

import "./Styles/Login.css";
import logo from "../Assets/logos.png";

const LoginPage = () => {
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    const storedRole = localStorage.getItem("userRole");
    const normalizedRole = (storedRole || '').toLowerCase().replace(/\s+/g, '');

    let target = "/dashboard";
    if (normalizedRole === "student") {
      target = "/profile";
    }

    navigate(target, { replace: true });
  }, [navigate]);

  const handleChange = (e) =>
    setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const response = await api.post("/api/Auth/login", formData);
      if (response.status === 200 && response.data.token) {
        localStorage.setItem("token", response.data.token);
        
        try {
            const tokenParts = response.data.token.split(".");
            if (tokenParts.length !== 3) throw new Error("Invalid token format");
            
            const tokenPayload = JSON.parse(atob(tokenParts[1]));
            const userRoleClaim = tokenPayload.role;
            const userIdClaim = tokenPayload.nameid;

            if (!userRoleClaim || !userIdClaim) {
              throw new Error("Token is missing required user ID or Role.");
            }

            const normalizedUserRole = (userRoleClaim || '').toLowerCase().replace(/\s+/g, '') ;

            localStorage.setItem("userRole", normalizedUserRole);
            const userToStore = {
              id: userIdClaim,
              name: tokenPayload.fullName || "User",
              email: tokenPayload.email,
              role: normalizedUserRole,
              imageP: tokenPayload.imageP
            };
            localStorage.setItem("user", JSON.stringify(userToStore));

            let target = '/';
            switch(normalizedUserRole) {
                case "superadmin": target = "/dashboard"; break;
                case "user": target = "/dashboard"; break;
                case "engineer": target = "/dashboard"; break;
                case "teacher": target = "/dashboard"; break;
                case "studentaffair": target = "/dashboard"; break;
                case "student": target = "/profile"; break;
                case "admin": target = "/dashboard"; break;
                case "board": target = "/dashboard"; break; 
                default: target = "/dashboard";
            }
            navigate(target);
        } catch (decodeError) {
            console.error("Token decoding error:", decodeError);
            setError("Login successful but failed to process user data.");
        }
      }
    } catch (err) {
      console.error("Login error:", err);
      setError(err.response?.data?.message || "Login failed. Please check your credentials.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="card-top-border"></div>
        
        <div className="login-header">
          <div className="logo-wrapper" style={{ display: 'flex' }}>
            <img src={logo} style={{ width: '50px', height: '50px', marginRight: '10px' }} alt="Elsewedy Logo" className="logo-img"/>
            <div className="logo-text">
              <span className="brand-name">Elsewedy</span>
              <h1 className="system-name">Attendance System</h1>
            </div>
          </div>
          <h1 className="welcome-title">Welcome Back</h1>
          <p className="welcome-subtitle">Sign in to your account to continue</p>
        </div>

        <form onSubmit={handleLogin} className="login-form">
          {error && <div className="error-alert">{error}</div>}

          <div className="input-group">
            <label>Email Address</label>
            <div className="input-field-wrapper">
              <FiMail className="input-icon left" />
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="YourName@sewedy.com"
                required
              />
            </div>
          </div>

          <div className="input-group">
            <label>Password</label>
            <div className="input-field-wrapper">
              <FiLock className="input-icon left" />
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="Enter your password"
                required
              />
              <div 
                className="toggle-password"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <FiEyeOff /> : <FiEye />}
              </div>
            </div>
            <div className="form-options">
               <Link to="/forgot-password" style={{ color: '#64748b', textDecoration: 'none', fontSize: '13px', fontWeight: '500' }}>Forgot Password?</Link>
            </div>
          </div>

          <button type="submit" className="login-btn" disabled={isLoading}>
            {isLoading ? "Signing In..." : (
              <>
                Sign In <FiArrowRight className="btn-icon" />
              </>
            )}
          </button>
        </form>

        <div className="login-footer">
          <p>
            Don't have an account? <Link to="/contact-admin" className="contact-link">Contact Administrator</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
