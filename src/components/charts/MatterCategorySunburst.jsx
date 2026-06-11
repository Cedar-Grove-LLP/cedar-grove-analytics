"use client";

import { useRef, useEffect, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { formatHours } from '../../utils/formatters';
import { CHART_COLORS, GRAY } from '@/utils/colors';
import { getSourceNote } from '@/utils/calcDefinitions.mjs';

const SOURCE_NOTE = getSourceNote('billableHours');

const MatterCategorySunburst = ({ data, title = "Time by Billing Category", minMatterPercentage = 3 }) => {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Transform matterData into hierarchical structure for sunburst
  // Top level: billing categories, children: matters
  const hierarchicalData = useMemo(() => {
    // Aggregate hours by category → matter
    const categoryMap = {};

    data.forEach(matter => {
      Object.entries(matter.byCategory || {}).forEach(([category, stats]) => {
        if (!categoryMap[category]) {
          categoryMap[category] = { totalHours: 0, matters: {} };
        }
        categoryMap[category].totalHours += stats.hours;

        if (!categoryMap[category].matters[matter.matter]) {
          categoryMap[category].matters[matter.matter] = { hours: 0, count: 0 };
        }
        categoryMap[category].matters[matter.matter].hours += stats.hours;
        categoryMap[category].matters[matter.matter].count += stats.count;
      });
    });

    const totalHours = Object.values(categoryMap).reduce((sum, c) => sum + c.totalHours, 0);

    // Build children array — one per billing category
    const children = Object.entries(categoryMap)
      .sort((a, b) => b[1].totalHours - a[1].totalHours)
      .map(([category, catData]) => {
        const catPercentage = totalHours > 0 ? (catData.totalHours / totalHours) * 100 : 0;

        // Separate matters within this category into main and small
        const matterEntries = Object.entries(catData.matters)
          .sort((a, b) => b[1].hours - a[1].hours);

        const mainMatters = [];
        const smallMatters = [];

        matterEntries.forEach(([matterName, matterStats]) => {
          const matterPct = catData.totalHours > 0 ? (matterStats.hours / catData.totalHours) * 100 : 0;
          if (matterPct >= minMatterPercentage) {
            mainMatters.push({ name: matterName, hours: matterStats.hours, count: matterStats.count });
          } else {
            smallMatters.push({ name: matterName, hours: matterStats.hours, count: matterStats.count });
          }
        });

        const matterChildren = [...mainMatters];

        // Group small matters into "Other" within this category
        if (smallMatters.length > 0) {
          const otherHours = smallMatters.reduce((sum, m) => sum + m.hours, 0);
          matterChildren.push({
            name: `Other (${smallMatters.length})`,
            hours: otherHours,
            count: smallMatters.reduce((sum, m) => sum + m.count, 0),
            isOtherGroup: true
          });
        }

        return {
          name: category,
          hours: catData.totalHours,
          percentage: catPercentage,
          children: matterChildren
        };
      });

    return {
      name: "All Categories",
      children
    };
  }, [data, minMatterPercentage]);

  // Update dimensions on mount and resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const { width } = containerRef.current.getBoundingClientRect();
        const size = Math.min(width, 500);
        setDimensions({ width: size, height: size });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  useEffect(() => {
    if (!svgRef.current || dimensions.width === 0 || data.length === 0) return;

    // Clear previous chart
    d3.select(svgRef.current).selectAll("*").remove();

    const width = dimensions.width;
    const height = dimensions.height;
    const radius = width / 6;

    // Color scale for billing categories
    const categoryColors = d3.scaleOrdinal()
      .domain(hierarchicalData.children.map(d => d.name))
      .range(CHART_COLORS);

    // Create hierarchy
    const hierarchy = d3.hierarchy(hierarchicalData)
      .sum(d => d.children ? 0 : d.hours || 0)
      .sort((a, b) => b.value - a.value);

    const root = d3.partition()
      .size([2 * Math.PI, hierarchy.height + 1])
      (hierarchy);

    root.each(d => d.current = d);

    // Arc generator
    const arc = d3.arc()
      .startAngle(d => d.x0)
      .endAngle(d => d.x1)
      .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.005))
      .padRadius(radius * 1.5)
      .innerRadius(d => d.y0 * radius)
      .outerRadius(d => Math.max(d.y0 * radius, d.y1 * radius - 1));

    // Create SVG
    const svg = d3.select(svgRef.current)
      .attr("viewBox", [-width / 2, -height / 2, width, width])
      .style("font", "10px sans-serif");

    // Get color for a node based on its top-level ancestor
    const getNodeColor = (d) => {
      let node = d;
      while (node.depth > 1) node = node.parent;
      const baseColor = categoryColors(node.data.name);

      if (d.depth === 1) return baseColor;
      if (d.depth === 2) return d3.color(baseColor).brighter(0.3).toString();
      if (d.depth === 3) return d3.color(baseColor).brighter(0.6).toString();
      return d3.color(baseColor).brighter(0.8).toString();
    };

    // Create paths
    const path = svg.append("g")
      .selectAll("path")
      .data(root.descendants().slice(1))
      .join("path")
      .attr("fill", d => getNodeColor(d))
      .attr("fill-opacity", d => arcVisible(d.current) ? (d.children ? 0.9 : 0.7) : 0)
      .attr("pointer-events", d => arcVisible(d.current) ? "auto" : "none")
      .attr("d", d => arc(d.current))
      .style("cursor", "pointer");

    // Add tooltips
    path.append("title")
      .text(d => {
        const ancestors = d.ancestors().map(d => d.data.name).reverse();
        const pathStr = ancestors.slice(1).join(" → ");
        const hours = formatHours(d.value);
        const percentage = d.parent ? Math.round((d.value / d.parent.value) * 100) : 100;
        return `${pathStr}\n${hours}h (${percentage}% of ${d.parent?.data.name || 'total'})\n${SOURCE_NOTE}`;
      });

    // Click handler for zoom
    path.filter(d => d.children)
      .on("click", clicked);

    // Add labels
    const label = svg.append("g")
      .attr("pointer-events", "none")
      .attr("text-anchor", "middle")
      .style("user-select", "none")
      .selectAll("g")
      .data(root.descendants().slice(1))
      .join("g")
      .attr("transform", d => labelTransform(d.current))
      .attr("opacity", d => +labelVisible(d.current));

    // Primary label (name)
    label.append("text")
      .attr("class", "label-name")
      .attr("dy", "0.35em")
      .text(d => {
        const name = d.data.name;
        return name.length > 12 ? name.substring(0, 10) + '...' : name;
      })
      .style("font-size", d => d.depth === 1 ? "11px" : "9px")
      .style("font-weight", d => d.depth === 1 ? "600" : "400")
      .style("fill", GRAY[700]);

    // Secondary label (hours) - only for leaf nodes, hidden initially
    label.append("text")
      .attr("class", "label-hours")
      .attr("dy", "1.4em")
      .text(d => !d.children ? `${formatHours(d.value)}h` : "")
      .style("font-size", "8px")
      .style("font-weight", "500")
      .style("fill", GRAY[500])
      .style("opacity", 0);

    // Center circle for clicking back
    const parent = svg.append("circle")
      .datum(root)
      .attr("r", radius)
      .attr("fill", "none")
      .attr("pointer-events", "all")
      .on("click", clicked);

    // Center text showing current level
    const centerText = svg.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "-0.5em")
      .style("font-size", "14px")
      .style("font-weight", "600")
      .style("fill", GRAY[700])
      .text("All Categories");

    const centerSubtext = svg.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "1em")
      .style("font-size", "12px")
      .style("fill", GRAY[500])
      .text(`${formatHours(root.value)}h total`);

    const centerHint = svg.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "2.5em")
      .style("font-size", "10px")
      .style("fill", GRAY[400])
      .text("Click to zoom");

    function clicked(event, p) {
      parent.datum(p.parent || root);

      // Update center text
      if (p.depth === 0) {
        centerText.text("All Categories");
        centerSubtext.text(`${formatHours(root.value)}h total`);
        centerHint.text("Click to zoom");
      } else {
        centerText.text(p.data.name);
        centerSubtext.text(`${formatHours(p.value)}h`);
        centerHint.text("Click center to zoom out");
      }

      root.each(d => d.target = {
        x0: Math.max(0, Math.min(1, (d.x0 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
        x1: Math.max(0, Math.min(1, (d.x1 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
        y0: Math.max(0, d.y0 - p.depth),
        y1: Math.max(0, d.y1 - p.depth)
      });

      const t = svg.transition().duration(750);

      path.transition(t)
        .tween("data", d => {
          const i = d3.interpolate(d.current, d.target);
          return t => d.current = i(t);
        })
        .filter(function(d) {
          return +this.getAttribute("fill-opacity") || arcVisible(d.target);
        })
        .attr("fill-opacity", d => arcVisible(d.target) ? (d.children ? 0.9 : 0.7) : 0)
        .attr("pointer-events", d => arcVisible(d.target) ? "auto" : "none")
        .attrTween("d", d => () => arc(d.current));

      label.filter(function(d) {
          return +this.getAttribute("opacity") || labelVisible(d.target);
        }).transition(t)
        .attr("opacity", d => +labelVisible(d.target))
        .attrTween("transform", d => () => labelTransform(d.current));

      // Show/hide hours labels based on zoom depth
      label.selectAll(".label-name")
        .transition(t)
        .attr("dy", p.depth >= 1 ? "-0.1em" : "0.35em");

      label.selectAll(".label-hours")
        .transition(t)
        .style("opacity", p.depth >= 1 ? 1 : 0);
    }

    function arcVisible(d) {
      return d.y1 <= 3 && d.y0 >= 1 && d.x1 > d.x0;
    }

    function labelVisible(d) {
      return d.y1 <= 3 && d.y0 >= 1 && (d.y1 - d.y0) * (d.x1 - d.x0) > 0.03;
    }

    function labelTransform(d) {
      const x = (d.x0 + d.x1) / 2 * 180 / Math.PI;
      const y = (d.y0 + d.y1) / 2 * radius;
      return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
    }

  }, [data, dimensions, hierarchicalData]);

  if (data.length === 0) {
    return (
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
        <div className="flex items-center justify-center h-64 text-gray-500">
          No matter data available
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-sm text-gray-500 mb-4">Click a category to zoom in, click center to zoom out</p>
      <div ref={containerRef} className="flex justify-center">
        <svg ref={svgRef} width={dimensions.width} height={dimensions.height} />
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap justify-center gap-3">
        {hierarchicalData.children.slice(0, 8).map((category, idx) => {
          const colors = CHART_COLORS;
          return (
            <div key={category.name} className="flex items-center gap-2 text-sm">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: colors[idx % colors.length] }}
              />
              <span className="text-gray-700">{category.name}</span>
              <span className="text-gray-400">({formatHours(category.hours)}h)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MatterCategorySunburst;
