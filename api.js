const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
export const api = async (path, options={})=>{
  const token=localStorage.getItem('iem_token');
  const headers={...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...(options.headers||{})};
  if(token) headers.Authorization=`Bearer ${token}`;
  const res=await fetch(`${API}${path}`,{...options,headers});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error||'Request failed');
  return data;
};
export const setSession=(token,user)=>{localStorage.setItem('iem_token',token);localStorage.setItem('iem_user',JSON.stringify(user));};
export const getUser=()=>{try{return JSON.parse(localStorage.getItem('iem_user')||'null')}catch{return null}};
export const logout=()=>{localStorage.removeItem('iem_token');localStorage.removeItem('iem_user');};
