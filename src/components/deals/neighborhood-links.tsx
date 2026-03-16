import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MapPin,
  Shield,
  GraduationCap,
  Footprints,
  Map,
  ExternalLink,
} from "lucide-react";

interface NeighborhoodLinksProps {
  deal: {
    address: string;
    city: string;
    state: string;
    zip?: string;
  };
}

export function NeighborhoodLinks({ deal }: NeighborhoodLinksProps) {
  const citySlug = deal.city.toLowerCase().replace(/\s+/g, "-");
  const stateSlug = deal.state.toLowerCase();
  const addressDashed = deal.address.toLowerCase().replace(/\s+/g, "-");
  const fullAddress = `${deal.address} ${deal.city} ${deal.state}`;

  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${deal.address}, ${deal.city}, ${deal.state} ${deal.zip || ""}`
  )}`;

  const links = [
    {
      label: "Google Maps",
      url: googleMapsUrl,
      icon: Map,
      color: "text-blue-400",
    },
    {
      label: "NeighborhoodScout",
      url: `https://www.neighborhoodscout.com/${stateSlug}/${citySlug}/`,
      icon: MapPin,
      color: "text-emerald-400",
    },
    {
      label: "CrimeMapping",
      url: "https://www.crimemapping.com/map",
      icon: Shield,
      color: "text-orange-400",
    },
    {
      label: "GreatSchools",
      url: `https://www.greatschools.org/search/search.page?q=${encodeURIComponent(fullAddress)}`,
      icon: GraduationCap,
      color: "text-yellow-400",
    },
    {
      label: "Walk Score",
      url: `https://www.walkscore.com/score/${addressDashed}`,
      icon: Footprints,
      color: "text-purple-400",
    },
  ];

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-white text-base flex items-center gap-2">
          <MapPin className="h-4 w-4" /> Neighborhood
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-slate-300 hover:text-white hover:bg-slate-800 rounded px-2 py-1.5 transition-colors group"
            >
              <link.icon className={`h-3.5 w-3.5 ${link.color}`} />
              <span className="flex-1">{link.label}</span>
              <ExternalLink className="h-3 w-3 text-slate-600 group-hover:text-slate-400" />
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
