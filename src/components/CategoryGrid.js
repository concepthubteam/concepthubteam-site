import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../constants/colors';
import { CATEGORIES } from '../data/mockData';
import { matchesFilter } from '../utils/filterUtils';
import { useEvents } from '../context/EventsContext';

export default function CategoryGrid({ selected, onSelect, filter = 'today' }) {
  const { events } = useEvents();

  return (
    <FlatList
      data={CATEGORIES}
      keyExtractor={item => item.id}
      numColumns={4}
      scrollEnabled={false}
      contentContainerStyle={styles.grid}
      renderItem={({ item }) => {
        const isSelected = selected === item.id;
        const count = events.filter(e =>
          e.category === item.id && matchesFilter(e, filter)
        ).length;

        return (
          <TouchableOpacity
            style={[
              styles.item,
              isSelected && { borderColor: item.color, borderWidth: 2 },
              count === 0 && styles.itemEmpty,
            ]}
            onPress={() => onSelect(isSelected ? null : item.id)}
            activeOpacity={0.8}
          >
            {/* Background image */}
            {item.image && (
              <Image
                source={{ uri: item.image }}
                style={StyleSheet.absoluteFillObject}
                resizeMode="cover"
              />
            )}
            {/* Gradient overlay — same as ExploreScreen */}
            <LinearGradient
              colors={
                isSelected
                  ? [`${item.color}55`, `${item.color}EE`]
                  : ['rgba(0,0,0,0.08)', `${item.color}D0`]
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
            <Text style={styles.icon}>{item.icon}</Text>
            <Text style={[styles.label, count === 0 && { opacity: 0.5 }]}>
              {item.label}
            </Text>
            {count > 0 && (
              <View style={[styles.countBadge, isSelected && { backgroundColor: item.color }]}>
                <Text style={styles.countText}>{count}</Text>
              </View>
            )}
            {isSelected && (
              <View style={[styles.dot, { backgroundColor: '#fff' }]} />
            )}
          </TouchableOpacity>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  grid: { paddingHorizontal: 16 },
  item: {
    flex: 1,
    margin: 4,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'flex-end',
    position: 'relative',
    minHeight: 88,
    overflow: 'hidden',
  },
  icon: {
    fontSize: 20,
    marginBottom: 4,
  },
  itemEmpty: { opacity: 0.45 },
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  countBadge: {
    position: 'absolute',
    bottom: 5,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  countText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
  },
  dot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 5,
    height: 5,
    borderRadius: 3,
  },
});
