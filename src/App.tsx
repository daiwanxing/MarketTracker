import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import OilPanel from './components/OilPanel';
import EnsoPanel from './components/EnsoPanel';
import GoldPanel from './components/GoldPanel';
import TechSemiPanel from './components/TechSemiPanel';
import EquipPanel from './components/EquipPanel';
import OpticsPanel from './components/OpticsPanel';

export default function App() {
  return (
    <div className="app">
      <div className="starfield" aria-hidden="true" />
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/oil" replace />} />
          <Route path="/oil" element={<OilPanel />} />
          <Route path="/enso" element={<EnsoPanel />} />
          <Route path="/gold" element={<GoldPanel />} />
          <Route path="/semi" element={<TechSemiPanel />} />
          <Route path="/equip" element={<EquipPanel />} />
          <Route path="/optics" element={<OpticsPanel />} />
        </Routes>
      </main>
    </div>
  );
}
